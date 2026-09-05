import type { MappingDomain, MappingResult, MappingScope } from "../mapping/types";

export type SyncScope = MappingScope;
export type CanonicalRow = Record<string, unknown>;
export type NormalizedValues = Record<string, string | number | boolean | null>;
export type FieldIssue = { field: string; code: string; message: string };
export type NormalizedRow = {
  values: NormalizedValues;
  /** Join hints are not columns on registrations/leads/classes. Never spread them into inserts. */
  hints: { name?: string; external_member_id?: string; trainer_name?: string; sales_trainer_name?: string };
  canonicalIdentity: string | null;
  issues: FieldIssue[];
};
export type SyncInput = SyncScope & {
  /** Trusted connection owner, never inferred from arbitrary spreadsheet text. */
  trainerId?: string | null;
  mappingVersionId: string;
  capturedAt: string;
  mapping: MappingResult;
  /** Complete tab values including the header row. */
  rows: unknown[][];
};
export type DomainCounts = { inserted: number; updated: number; unchanged: number; reviewRequired: number; rejected: number };
export type SyncResult = Record<MappingDomain, DomainCounts>;
export type RawSnapshot = {
  id: string;
  scope: SyncScope;
  snapshotKey: string;
  capturedAt: string;
  sourcePayload: { rows: unknown[][] };
};
export type StoredRecord = NormalizedRow & {
  domain: MappingDomain;
  organization_id: string;
  trainer_id: string | null;
  source_connection_id: string;
  source_tab_id: string;
  source_record_key: string;
  raw_snapshot_id: string;
  mapping_version_id: string;
  mapping_confidence: number;
  record_status: "valid" | "review_required";
};
export type AuditEvent = {
  scope: SyncScope;
  domain: MappingDomain;
  sourceRecordKey: string;
  action: "insert" | "update";
  rawSnapshotId: string;
  previousRawSnapshotId: string | null;
  mappingVersionId: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  issues: FieldIssue[];
};
export type SyncTransaction = {
  find(domain: MappingDomain, sourceRecordKey: string): Promise<StoredRecord | null>;
  /** Persist schema-compatible values + provenance; preserve hints/issues in audit payload.
   * Resolve member joins within this organization, never by name across tenants.
   * The unique key is organization + connection + tab + source_record_key. */
  upsert(record: StoredRecord): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
};
export type SyncRepository = {
  /** INSERT ON CONFLICT DO NOTHING and return the existing ID. No snapshot UPDATE.
   * Commit before transaction(); failed normalization must leave the source available. */
  insertSnapshot(snapshot: Omit<RawSnapshot, "id">): Promise<string>;
  /** Atomic records + audits; serialize concurrent syncs for this scope (lock or retry
   * serializable transactions). Do not emulate this with sequential Supabase REST writes. */
  transaction<T>(scope: SyncScope, operation: (tx: SyncTransaction) => Promise<T>): Promise<T>;
};
