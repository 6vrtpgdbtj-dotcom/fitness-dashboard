import { fingerprint, sourceRecordKey, stableJson } from "./fingerprint";
import { normalizeMember } from "./normalize-member";
import { normalizeRegistration } from "./normalize-registration";
import { normalizeLead } from "./normalize-lead";
import { normalizeClass } from "./normalize-class";
import { redactPhones } from "./normalize-fields";
import type { AuditEvent, CanonicalRow, DomainCounts, StoredRecord, SyncInput, SyncRepository, SyncResult, SyncScope } from "./types";

function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value ?? null;
}
export function redactSourceRows(rows: unknown[][], fields: SyncInput["mapping"]["fields"] = []): unknown[][] {
  return rows.map((row) => row.map((cell, index) => {
    if (fields.some((field) => field.columnIndex === index && field.field === "phone_last4") && typeof cell !== "object") {
      const digits = String(cell ?? "").replace(/\D/g, "");
      if (digits.length >= 4) return digits.slice(-4);
    }
    return scrub(cell);
  }));
}
function content(record: StoredRecord): Record<string, unknown> {
  return { ...record.values, hints: record.hints, record_status: record.record_status, trainer_id: record.trainer_id, issues: record.issues };
}
function changes(previous: StoredRecord | null, next: StoredRecord): AuditEvent["changes"] {
  const before = previous ? content(previous) : {};
  const after = content(next);
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => stableJson(before[key]) !== stableJson(after[key])).map((key) => [key, { before: scrub(before[key]), after: scrub(after[key]) }]));
}

export async function applySync(input: SyncInput, db: SyncRepository): Promise<SyncResult> {
  const scope: SyncScope = { organizationId: input.organizationId, sourceConnectionId: input.sourceConnectionId, sourceTabId: input.sourceTabId };
  const { mapping } = input;
  const rows = redactSourceRows(input.rows, mapping.fields);
  // Detached payload: callers may reuse/mutate their rows after this operation.
  const rawSnapshotId = await db.insertSnapshot({ scope, snapshotKey: fingerprint(rows), capturedAt: input.capturedAt, sourcePayload: { rows } });
  const counts = (): DomainCounts => ({ inserted: 0, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 });
  let rejected = 0;
  const normalize = { member: normalizeMember, registration: normalizeRegistration, lead: normalizeLead, class: normalizeClass }[mapping.domain];
  const records: StoredRecord[] = [];
  for (const row of rows.slice(mapping.headerRowIndex === null ? 0 : mapping.headerRowIndex + 1)) {
    if (row.every((cell) => cell == null || String(cell).trim() === "")) { rejected++; continue; }
    const canonical: CanonicalRow = {};
    for (const field of mapping.fields) if (field.field !== null) canonical[field.field] = row[field.columnIndex];
    const normalized = normalize(canonical);
    for (const field of mapping.missingRequiredFields) if (!normalized.issues.some((issue) => issue.field === field)) normalized.issues.push({ field, code: "unmapped_required", message: "Required source column needs mapping confirmation." });
    if (mapping.headerRowIndex === null) normalized.issues.push({ field: "header", code: "missing_header", message: "Header row needs confirmation." });
    records.push({ ...normalized, domain: mapping.domain, organization_id: scope.organizationId, trainer_id: input.trainerId ?? null,
      source_connection_id: scope.sourceConnectionId, source_tab_id: scope.sourceTabId,
      source_record_key: sourceRecordKey(scope.sourceConnectionId, scope.sourceTabId, normalized.canonicalIdentity ?? `review:${fingerprint(row)}`),
      raw_snapshot_id: rawSnapshotId, mapping_version_id: input.mappingVersionId, mapping_confidence: mapping.confidence,
      record_status: normalized.issues.some((issue) => issue.severity !== "warning") ? "review_required" : "valid" });
  }
  const groups = new Map<string, StoredRecord[]>();
  for (const record of records) groups.set(record.source_record_key, [...(groups.get(record.source_record_key) ?? []), record]);
  const proposedCounts = new Map<string, { category: keyof DomainCounts; validCategory: keyof DomainCounts; count: number; groupSize: number }>();
  return db.transaction(scope, async (tx) => {
    proposedCounts.clear();
    // A serializable repository may retry this callback. Each attempt owns its
    // counters and records, so a rolled-back attempt leaves no application state.
    const result: SyncResult = { member: counts(), registration: counts(), lead: counts(), class: counts() };
    const tally = result[mapping.domain];
    tally.rejected = rejected;
    for (const group of groups.values()) {
      // Stable choice keeps repeated/sorted ambiguous rows idempotent. All raw rows survive.
      const record = structuredClone([...group].sort((a, b) => {
        const left = stableJson(content(a));
        const right = stableJson(content(b));
        return left < right ? -1 : left > right ? 1 : 0;
      })[0]);
      if (group.length > 1) {
        record.record_status = "review_required";
        record.issues.push({ field: "identity", code: "duplicate_identity", message: "Multiple source rows share this identity; add a unique source ID." });
      }
      const previous = await tx.find(record.domain, record.source_record_key);
      const delta = changes(previous, record);
      const changed = Object.keys(delta).length > 0;
      if (record.record_status === "review_required") tally.reviewRequired += group.length;
      else if (!previous) tally.inserted++;
      else if (changed) tally.updated++;
      else tally.unchanged++;
      const validCategory = !previous ? "inserted" : changed ? "updated" : "unchanged";
      proposedCounts.set(record.source_record_key, { category: record.record_status === "review_required" ? "reviewRequired" : validCategory, validCategory, count: record.record_status === "review_required" ? group.length : 1, groupSize: group.length });
      // Refresh provenance even when business values have not changed.
      await tx.upsert(record);
      if (!previous || changed) await tx.appendAudit({ scope, domain: record.domain, sourceRecordKey: record.source_record_key, action: previous ? "update" : "insert", rawSnapshotId, previousRawSnapshotId: previous?.raw_snapshot_id ?? null, mappingVersionId: input.mappingVersionId, changes: delta, issues: record.issues });
    }
    return result;
  }, (result, outcomes) => {
    for (const outcome of outcomes) {
      const proposed = proposedCounts.get(outcome.sourceRecordKey);
      if (!proposed) continue;
      const category = outcome.recordStatus === "review_required" ? "reviewRequired" : outcome.recordStatus === "valid" ? proposed.validCategory : "rejected";
      result[outcome.domain][proposed.category] -= proposed.count;
      result[outcome.domain][category] += category === "reviewRequired" ? proposed.groupSize : 1;
    }
    return result;
  });
}
