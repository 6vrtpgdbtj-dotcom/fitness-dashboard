"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { canonicalFields, missingRequiredFields } from "./canonical-fields";
import { normalizeHeader } from "./header-normalizer";
import { mappingFingerprint } from "./map-columns";
import type { SaveMappingInput, SavedMappingVersion } from "./types";

const schema = z.object({
  sourceConnectionId: z.string().uuid(),
  sourceTabId: z.string().uuid(),
  domain: z.enum(["member", "registration", "lead", "class"]),
  headerRowIndex: z.number().int().min(0),
  columns: z.array(z.object({ sourceHeader: z.string().max(500), field: z.string().nullable() })).min(1).max(1000),
}).strict();

export async function saveMappingVersion(value: SaveMappingInput): Promise<SavedMappingVersion> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Administrator access is required.");
  const input = schema.parse(value);
  const mapped = input.columns.filter((column) => column.field !== null);
  const selected = mapped.map((column) => column.field);
  if (selected.some((field) => !canonicalFields[input.domain].some((definition) => definition.id === field)) || new Set(selected).size !== selected.length) throw new Error("Invalid or duplicate standard fields.");
  if (mapped.some((column) => !normalizeHeader(column.sourceHeader))) throw new Error("Mapped columns require a source header.");
  const missing = missingRequiredFields(input.domain, selected);
  if (missing.length) throw new Error("Required mapping fields are missing.");

  const client = await createClient();
  const { data: profile, error: profileError } = await client.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.organization_id) throw new Error("Could not resolve the organization.");
  const organizationId = profile.organization_id;
  const { data: tab, error: tabError } = await client.from("sheet_tabs").select("id, domain")
    .eq("id", input.sourceTabId).eq("source_connection_id", input.sourceConnectionId).eq("organization_id", organizationId).maybeSingle();
  if (tabError || !tab) throw new Error("The source tab was not found.");
  if (tab.domain && tab.domain !== input.domain) throw new Error("The mapping domain does not match the source tab.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest, error: latestError } = await client.from("mapping_versions").select("version")
      .eq("organization_id", organizationId).eq("source_connection_id", input.sourceConnectionId).eq("source_tab_id", input.sourceTabId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (latestError) throw new Error("Could not read mapping history.");
    const { data: created, error } = await client.from("mapping_versions").insert({
      organization_id: organizationId,
      source_connection_id: input.sourceConnectionId,
      source_tab_id: input.sourceTabId,
      version: (latest?.version ?? 0) + 1,
      mapping_fingerprint: mappingFingerprint(input.domain, input.headerRowIndex, input.columns.map((column) => column.sourceHeader)),
      columns: { domain: input.domain, headerRowIndex: input.headerRowIndex, fields: input.columns },
      missing_required_fields: missing,
      mapping_confidence: 1,
      confirmed_by: user.id,
    }).select("id, version").single();
    if (!error && created) return { id: created.id, version: created.version };
    // The unique source/version constraint arbitrates concurrent administrators.
    if (error?.code !== "23505") throw new Error("Could not save the mapping version.");
  }
  throw new Error("Mapping history changed concurrently. Please save again.");
}
