import type { AuditEvent, CommitOutcome, StoredRecord, SyncRepository, SyncScope } from "./types";
export type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
export async function rpc<T>(client: RpcClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.message === "lease_lost" ? "lease_lost" : "storage_failed" });
  return data as T;
}
const scopeArgs = (scope: SyncScope) => ({ p_organization_id: scope.organizationId, p_connection_id: scope.sourceConnectionId, p_tab_id: scope.sourceTabId });
/** Callback writes stay buffered; the commit RPC validates the lease and commits
 * canonical rows, comparison metadata, and audit history in one DB transaction. */
export function createRpcSyncRepository(client: RpcClient, lease: string): SyncRepository {
  return {
    insertSnapshot(snapshot) {
      return rpc<string>(client, "sync_insert_snapshot", { ...scopeArgs(snapshot.scope), p_snapshot_key: snapshot.snapshotKey, p_captured_at: snapshot.capturedAt, p_payload: snapshot.sourcePayload });
    },
    async transaction(scope, operation, afterCommit) {
      const records = await rpc<StoredRecord[]>(client, "sync_read_records", { ...scopeArgs(scope), p_lease: lease });
      const current = new Map(records.map((record) => [`${record.domain}:${record.source_record_key}`, record]));
      const writes: StoredRecord[] = []; const audits: AuditEvent[] = [];
      const result = await operation({
        async find(domain, key) { return structuredClone(current.get(`${domain}:${key}`) ?? null); },
        async upsert(record) { const copy = structuredClone(record); writes.push(copy); current.set(`${copy.domain}:${copy.source_record_key}`, copy); },
        async appendAudit(event) { audits.push(structuredClone(event)); },
      });
      const outcomes = await rpc<CommitOutcome[] | null>(client, "sync_commit_records", { ...scopeArgs(scope), p_lease: lease, p_records: writes, p_audits: audits });
      return afterCommit && Array.isArray(outcomes) ? afterCommit(result, outcomes) : result;
    },
  };
}
