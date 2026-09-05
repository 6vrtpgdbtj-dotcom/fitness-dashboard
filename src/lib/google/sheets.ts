import "server-only";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizedGoogleClientForProfile } from "./oauth";

export type SpreadsheetMetadata = {
  spreadsheetId: string;
  title: string;
  tabs: Array<{ googleSheetId: number; title: string }>;
};

export async function getOrganizationId(profileId: string): Promise<string> {
  const client = await createClient();
  const { data: profile, error } = await client.from("profiles")
    .select("organization_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !profile?.organization_id) throw new Error("Could not resolve the authenticated organization.");
  return profile.organization_id;
}

export async function readSpreadsheetMetadata(spreadsheetId: string, profileId?: string): Promise<SpreadsheetMetadata> {
  if (!profileId) throw new Error("An administrator authorization is required to read spreadsheet metadata.");
  const auth = await getAuthorizedGoogleClientForProfile(profileId);
  const response = await google.sheets({ version: "v4", auth }).spreadsheets.get({ spreadsheetId, fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title)" });
  const data = response.data;
  if (!data.spreadsheetId || !data.properties?.title) throw new Error("Google returned incomplete spreadsheet metadata.");
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties.title,
    tabs: (data.sheets ?? []).flatMap((sheet) => {
      const sheetId = sheet.properties?.sheetId;
      const title = sheet.properties?.title;
      return typeof sheetId === "number" && typeof title === "string" ? [{ googleSheetId: sheetId, title }] : [];
    }),
  };
}

export async function createSheetConnection(input: {
  organizationId: string;
  connectedBy: string;
  trainerId?: string;
  metadata: SpreadsheetMetadata;
}) {
  const client = await createClient();
  const { data: connection, error } = await client.from("sheet_connections").upsert({
    organization_id: input.organizationId,
    spreadsheet_id: input.metadata.spreadsheetId,
    display_name: input.metadata.title,
    connected_by: input.connectedBy,
    trainer_id: input.trainerId ?? null,
    status: "pending",
    is_active: true,
  }, { onConflict: "organization_id,spreadsheet_id" }).select("id").single();
  if (error || !connection) throw new Error("Could not save the Google Sheet connection.");

  const { error: tabsError } = await client.from("sheet_tabs").upsert(input.metadata.tabs.map((tab) => ({
    organization_id: input.organizationId,
    source_connection_id: connection.id,
    google_sheet_id: tab.googleSheetId,
    title: tab.title,
  })), { onConflict: "organization_id,source_connection_id,google_sheet_id" });
  if (tabsError) throw new Error("Could not save the Google Sheet tabs.");

  const { error: jobError } = await client.from("sync_jobs").upsert({
    organization_id: input.organizationId,
    source_connection_id: connection.id,
    idempotency_key: `initial:${input.metadata.spreadsheetId}`,
    reason: "initial_connection",
    status: "pending",
  }, { onConflict: "organization_id,source_connection_id,idempotency_key", ignoreDuplicates: true });
  if (jobError) throw new Error("Could not queue the initial sheet sync.");
  return connection;
}

export async function listSheetConnections() {
  const client = await createClient();
  const { data, error } = await client.from("sheet_connections")
    .select("id, display_name, trainer_id, status, last_successful_sync_at, sheet_tabs(title), trainers(display_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load Google Sheet connections.");
  return data ?? [];
}
