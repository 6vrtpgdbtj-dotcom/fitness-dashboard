import "server-only";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthorizedGoogleClient } from "@/lib/google/oauth";
import { createSyncService, type Connection, type Watch, type SyncDependencies } from "./orchestration";
import { createRpcSyncRepository, rpc } from "./supabase-repository";
import { applySync } from "./apply-sync";
import { mapColumns } from "../mapping/map-columns";
import { discoverDomain } from "./sheet-pipeline";
import type { ConfirmedMapping, MappingDomain } from "../mapping/types";
import type { SyncResult } from "./types";
import { stableJson } from "./fingerprint";

function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw Object.assign(new Error("Sync storage operation failed."), { code: "storage_failed" });
  return data;
}
const emptyResult = (): SyncResult => Object.fromEntries(["member", "registration", "lead", "class"].map((domain) => [domain, { inserted: 0, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 }])) as SyncResult;

export function getSyncService() {
  // Configuration is read lazily so route authorization can fail closed even
  // before Google/Supabase have been configured.
  const database = () => createAdminClient();
  const deps: SyncDependencies = {
    secret: process.env.GOOGLE_WATCH_SECRET ?? "",
    notificationUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/google/notifications`,
    now: () => new Date(), random: Math.random, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async getConnection(id) {
      const row = checked(await database().from("sheet_connections").select("id,organization_id,spreadsheet_id,is_active,trainer_id").eq("id", id).maybeSingle());
      return row ? { id: row.id, organizationId: row.organization_id, spreadsheetId: row.spreadsheet_id, active: row.is_active, trainerId: row.trainer_id } : null;
    },
    acquire: (id, reason) => rpc(database(), "sync_acquire", { p_connection_id: id, p_reason: reason }),
    release: (id, lease) => rpc(database(), "sync_release", { p_connection_id: id, p_lease: lease }),
    finish: (id, lease, result) => rpc(database(), "sync_finish", { p_connection_id: id, p_lease: lease, p_ok: result.ok, p_result: result.ok ? result.data : {}, p_code: result.ok ? null : result.code, p_retryable: !result.ok && result.retryable }),
    async execute(connection, lease) {
      const db = database(); const auth = await getAuthorizedGoogleClient(connection.id);
      const sheets = google.sheets({ version: "v4", auth });
      const metadata = await sheets.spreadsheets.get({ spreadsheetId: connection.spreadsheetId, fields: "sheets.properties(sheetId,title)" }, { timeout: 15000 });
      const tabs = (metadata.data.sheets ?? []).flatMap((sheet) => typeof sheet.properties?.sheetId === "number" && sheet.properties.title ? [{ googleSheetId: sheet.properties.sheetId, title: sheet.properties.title }] : []);
      const total = emptyResult();
      // Apply members first to resolve organization-scoped links in other tabs.
      const prepared: Array<{ tab: typeof tabs[number]; rows: unknown[][]; domain: MappingDomain; tabId: string }> = [];
      for (const tab of tabs) {
        const values = await sheets.spreadsheets.values.get({ spreadsheetId: connection.spreadsheetId, range: `'${tab.title.replaceAll("'", "''")}'`, valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }, { timeout: 15000 });
        const rows: unknown[][] = values.data.values ?? [];
        const previous = checked(await db.from("sheet_tabs").select("id,domain,is_active").eq("organization_id", connection.organizationId).eq("source_connection_id", connection.id).eq("google_sheet_id", tab.googleSheetId).maybeSingle());
        if (previous?.is_active === false) continue;
        const domain: MappingDomain | null = previous?.domain ?? discoverDomain(tab.title, rows);
        const stored = checked(await db.from("sheet_tabs").upsert({ organization_id: connection.organizationId, source_connection_id: connection.id, google_sheet_id: tab.googleSheetId, title: tab.title, domain }, { onConflict: "organization_id,source_connection_id,google_sheet_id" }).select("id").single());
        if (!stored) throw new Error("Could not save the source tab.");
        if (domain) prepared.push({ tab, rows, domain, tabId: stored.id });
      }
      prepared.sort((a, b) => Number(b.domain === "member") - Number(a.domain === "member"));
      for (const { tab, rows, domain, tabId } of prepared) {
        await rpc(db, "sync_assert_lease", { p_connection_id: connection.id, p_lease: lease });
        const scope = { organizationId: connection.organizationId, sourceConnectionId: connection.id, sourceTabId: tabId };
        const versions = checked(await db.from("mapping_versions").select("id,version,columns,confirmed_by,mapping_fingerprint").eq("organization_id", connection.organizationId).eq("source_connection_id", connection.id).eq("source_tab_id", tabId).order("version", { ascending: false }));
        const history: ConfirmedMapping[] = (versions ?? []).filter((version) => version.confirmed_by && version.columns?.domain === domain && Array.isArray(version.columns?.fields)).map((version) => ({ ...scope, domain, version: version.version, headerRowIndex: version.columns.headerRowIndex, columns: version.columns.fields }));
        const mapping = mapColumns({ ...scope, rows, domain, tabTitle: tab.title }, history);
        // Store accepted mapping decisions; sample values never enter history.
        const columns = { domain, headerRowIndex: mapping.headerRowIndex, fields: mapping.fields.map((field) => ({ sourceHeader: field.sourceHeader, field: field.field })) };
        let version = (versions ?? []).find((entry) => entry.mapping_fingerprint === mapping.mappingFingerprint && stableJson(entry.columns) === stableJson(columns));
        if (!version) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const latest = checked(await db.from("mapping_versions").select("version").eq("organization_id", connection.organizationId).eq("source_connection_id", connection.id).eq("source_tab_id", tabId).order("version", { ascending: false }).limit(1).maybeSingle());
            const created = await db.from("mapping_versions").insert({ organization_id: connection.organizationId, source_connection_id: connection.id, source_tab_id: tabId, version: (latest?.version ?? 0) + 1, mapping_fingerprint: mapping.mappingFingerprint, columns, missing_required_fields: mapping.missingRequiredFields, mapping_confidence: mapping.confidence }).select("id,version,columns,confirmed_by,mapping_fingerprint").single();
            if (!created.error) { version = created.data; break; }
            if (created.error.code !== "23505") checked(created);
          }
        }
        if (!version) throw new Error("Mapping history changed concurrently.");
        checked(await db.from("sheet_tabs").update({ header_row: mapping.headerRowIndex === null ? null : mapping.headerRowIndex + 1, headers: mapping.fields.map((field) => field.sourceHeader) }).eq("id", tabId).eq("organization_id", connection.organizationId));
        const result = await applySync({ ...scope, trainerId: connection.trainerId, rows, mapping, mappingVersionId: version.id, capturedAt: new Date().toISOString() }, createRpcSyncRepository(db, lease));
        for (const key of Object.keys(total) as MappingDomain[]) for (const count of Object.keys(total[key]) as Array<keyof SyncResult[MappingDomain]>) total[key][count] += result[key][count];
      }
      return total;
    },
    async findWatch(channelId) {
      const row = checked(await database().from("sync_watches").select("channel_id,source_connection_id,resource_id,expires_at,last_message_number").eq("channel_id", channelId).maybeSingle());
      // Cursor comparison happens in PostgreSQL numeric, never a JS number.
      return row ? { channelId: row.channel_id, connectionId: row.source_connection_id, resourceId: row.resource_id, expiration: new Date(row.expires_at), lastMessageNumber: "0", token: "" } : null;
    },
    async saveWatch(watch) {
      const db = database();
      checked(await db.from("sync_watches").upsert({ channel_id: watch.channelId, source_connection_id: watch.connectionId, resource_id: watch.resourceId, expires_at: watch.expiration.toISOString() }, { onConflict: "channel_id" }));
      if (watch.resourceId) {
        checked(await db.from("sheet_connections").update({ watch_channel_id: watch.channelId, watch_resource_id: watch.resourceId, watch_expires_at: watch.expiration.toISOString(), last_message_number: null }).eq("id", watch.connectionId));
        // Renew first, then stop old channels. During overlap both remain valid.
        const previous = checked(await db.from("sync_watches").select("channel_id,resource_id,expires_at").eq("source_connection_id", watch.connectionId).neq("channel_id", watch.channelId));
        for (const old of previous ?? []) {
          try { if (old.resource_id) await deps.stopWatch({ channelId: old.channel_id, connectionId: watch.connectionId, resourceId: old.resource_id, expiration: new Date(old.expires_at), token: "", lastMessageNumber: "0" }); await deps.removeWatch(old.channel_id); }
          catch { /* An old channel expires naturally; it remains verifiable. */ }
        }
      }
    },
    async removeWatch(channelId) { checked(await database().from("sync_watches").delete().eq("channel_id", channelId)); },
    async createWatch(connection: Connection, watch: Watch, address) {
      const auth = await getAuthorizedGoogleClient(connection.id);
      const response = await google.drive({ version: "v3", auth }).files.watch({ fileId: connection.spreadsheetId, requestBody: { id: watch.channelId, type: "web_hook", token: watch.token, address, expiration: String(watch.expiration.getTime()) } }, { timeout: 15000 });
      return { resourceId: response.data.resourceId ?? "", expiration: new Date(Number(response.data.expiration)) };
    },
    async stopWatch(watch) { const auth = await getAuthorizedGoogleClient(watch.connectionId); await google.drive({ version: "v3", auth }).channels.stop({ requestBody: { id: watch.channelId, resourceId: watch.resourceId } }, { timeout: 15000 }); },
    acceptNotification: (watch, number) => rpc(database(), "sync_accept_notification", { p_channel_id: watch.channelId, p_resource_id: watch.resourceId, p_message_number: number }),
    candidates: (now) => rpc(database(), "sync_candidates", { p_now: now.toISOString() }),
  };
  return createSyncService(deps);
}
