import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SyncResult } from "./types";
import { classifySyncError, withRetry } from "./retry-policy";

export type SyncReason = "initial_connection" | "notification" | "reconciliation" | "manual";
export type Connection = { id: string; organizationId: string; spreadsheetId: string; active: boolean; trainerId?: string | null };
export type Watch = { channelId: string; connectionId: string; resourceId: string | null; token: string; expiration: Date; lastMessageNumber: string };
export type SyncDependencies = {
  secret: string; notificationUrl: string; now(): Date; random(): number; sleep(ms: number): Promise<void>;
  getConnection(id: string): Promise<Connection | null>;
  acquire(id: string, reason: SyncReason | "watch"): Promise<string | null>;
  release(id: string, lease: string): Promise<void>;
  execute(connection: Connection, lease: string): Promise<SyncResult>;
  finish(id: string, lease: string, result: { ok: true; data: SyncResult } | { ok: false; code: string; retryable: boolean }): Promise<void>;
  findWatch(channelId: string): Promise<Watch | null>;
  /** Fenced persistence; activation returns only its atomically selected predecessor. */
  saveWatch(watch: Watch, lease: string): Promise<Watch | null>;
  removeWatch(watch: Watch, lease: string): Promise<void>;
  createWatch(connection: Connection, watch: Watch, address: string): Promise<{ resourceId: string; expiration: Date }>;
  stopWatch(watch: Watch, lease: string): Promise<void>;
  /** Atomically advance the numeric cursor AND insert the durable pending job. */
  acceptNotification(watch: Watch, messageNumber: string): Promise<boolean>;
  candidates(now: Date): Promise<Array<{ connectionId: string; sync: boolean; renew: boolean }>>;
};
export function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function tokenFor(secret: string, connectionId: string, channelId: string) {
  return createHmac("sha256", secret).update(JSON.stringify([connectionId, channelId])).digest("base64url");
}
function failure(code: string) { return Object.assign(new Error(code), { code }); }

export function createSyncService(deps: SyncDependencies) {
  async function runSheetSync(connectionId: string, reason: SyncReason): Promise<SyncResult> {
    const connection = await deps.getConnection(connectionId);
    if (!connection?.active) throw failure("connection_not_found");
    const lease = await deps.acquire(connectionId, reason);
    if (!lease) throw failure("sync_busy");
    try {
      const result = await withRetry(() => deps.execute(connection, lease), deps);
      await deps.finish(connectionId, lease, { ok: true, data: result });
      return result;
    } catch (error) {
      await deps.finish(connectionId, lease, { ok: false, ...classifySyncError(error) });
      throw error;
    } finally { await deps.release(connectionId, lease); }
  }
  async function registerWatch(connectionId: string) {
    if (deps.secret.length < 32 || new URL(deps.notificationUrl).protocol !== "https:") throw new Error("A secure watch secret and HTTPS notification URL are required.");
    const connection = await deps.getConnection(connectionId);
    if (!connection?.active) throw failure("connection_not_found");
    const lease = await deps.acquire(connectionId, "watch");
    if (!lease) throw failure("sync_busy");
    const channelId = randomUUID();
    const watch: Watch = { channelId, connectionId, token: tokenFor(deps.secret, connectionId, channelId), resourceId: null, expiration: new Date(deps.now().getTime() + 24 * 60 * 60 * 1000), lastMessageNumber: "0" };
    let activated = false;
    try {
      // Persist before files.watch: Google can send its initial sync before the
      // watch response returns. Pending watches ignore that initial handshake.
      await deps.saveWatch(watch, lease);
      const registered = await deps.createWatch(connection, watch, deps.notificationUrl);
      Object.assign(watch, registered);
      if (!registered.resourceId || !Number.isFinite(registered.expiration.getTime()) || registered.expiration <= deps.now()) throw new Error("Google returned an invalid watch.");
      const previous = await deps.saveWatch({ ...watch, ...registered }, lease);
      activated = true;
      if (previous) {
        try { if (previous.resourceId) await deps.stopWatch(previous, lease); await deps.removeWatch(previous, lease); }
        catch { /* Activation succeeded. Its predecessor expires naturally if cleanup loses its lease. */ }
      }
      return { channelId, expiration: registered.expiration };
    } catch (error) {
      if (!activated) {
        // Storage may have activated the channel even if its response was lost.
        // The cleanup RPC rejects current channels and stale/foreign leases.
        try { if (watch.resourceId) await deps.stopWatch(watch, lease); await deps.removeWatch(watch, lease); }
        catch { /* Leave the channel to expire if fenced cleanup is unavailable. */ }
      }
      throw error;
    } finally { await deps.release(connectionId, lease); }
  }
  async function accept(headers: Headers): Promise<{ status: number; connectionId?: string }> {
    const state = headers.get("x-goog-resource-state");
    if (!["sync", "update", "trash", "untrash", "remove", "change"].includes(state ?? "")) return { status: 204 };
    const channelId = headers.get("x-goog-channel-id") ?? "";
    const resourceId = headers.get("x-goog-resource-id") ?? "";
    const token = headers.get("x-goog-channel-token") ?? "";
    const number = headers.get("x-goog-message-number") ?? "";
    if (!channelId || !resourceId || !/^\d{1,20}$/.test(number) || BigInt(number) < BigInt(1)) return { status: 403 };
    const watch = await deps.findWatch(channelId);
    if (!watch || deps.secret.length < 32 || watch.expiration <= deps.now() || !constantTimeEqual(token, tokenFor(deps.secret, watch.connectionId, channelId))) return { status: 403 };
    if (state === "sync" && watch.resourceId === null) return { status: 204 };
    if (resourceId !== watch.resourceId) return { status: 403 };
    const accepted = await deps.acceptNotification(watch, number);
    return { status: 204, ...(accepted ? { connectionId: watch.connectionId } : {}) };
  }
  async function reconcile() {
    const result = { synced: 0, renewed: 0, failed: 0 };
    const candidates = await deps.candidates(deps.now());
    let next = 0;
    async function worker() {
      while (next < candidates.length) {
        const candidate = candidates[next++];
        if (candidate.sync) {
          try { await runSheetSync(candidate.connectionId, "reconciliation"); result.synced++; }
          catch { result.failed++; }
        }
        if (candidate.renew) {
          try { await registerWatch(candidate.connectionId); result.renewed++; }
          catch { result.failed++; }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
    return result;
  }
  return { runSheetSync, registerWatch, accept, reconcile, getConnection: deps.getConnection };
}
export type SyncService = ReturnType<typeof createSyncService>;
