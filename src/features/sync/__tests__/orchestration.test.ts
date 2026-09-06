// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withRetry } from "../retry-policy";
import { createSyncService, type SyncDependencies, type Connection, type Watch } from "../orchestration";
import { notificationResponse, reconcileResponse, manualSyncResponse } from "../http-handlers";

function fixture() {
  const connections: Connection[] = ["a", "b"].map((id) => ({ id, organizationId: "org", spreadsheetId: id, active: true }));
  const watches = new Map<string, Watch>();
  const locks = new Set<string>();
  const jobs = new Set<string>();
  const failures: string[] = [];
  const synced: string[] = [];
  const renewed: string[] = [];
  const background: (() => Promise<void>)[] = [];
  const deps: SyncDependencies = {
    secret: "a-long-random-watch-secret-for-tests", notificationUrl: "https://example.com/api/google/notifications",
    now: () => new Date("2026-09-06T00:00:00Z"), random: () => 0.5, sleep: async () => {},
    getConnection: async (id) => connections.find((entry) => entry.id === id) ?? null,
    acquire: async (id) => { if (locks.has(id)) return null; locks.add(id); return "lease"; },
    release: async (id) => { locks.delete(id); },
    execute: async (connection) => { synced.push(connection.id); return { member: { inserted: 1, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 }, registration: { inserted: 0, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 }, lead: { inserted: 0, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 }, class: { inserted: 0, updated: 0, unchanged: 0, reviewRequired: 0, rejected: 0 } }; },
    finish: async (id, _lease, result) => { if (!result.ok) failures.push(`${id}:${result.code}`); },
    findWatch: async (id) => watches.get(id) ?? null,
    saveWatch: async (watch) => { watches.set(watch.channelId, watch); },
    removeWatch: async (id) => { watches.delete(id); },
    createWatch: async (_connection, watch) => { renewed.push(watch.connectionId); return { resourceId: "resource", expiration: new Date("2026-09-07T00:00:00Z") }; },
    stopWatch: async () => {},
    acceptNotification: async (watch, number) => { const current = watches.get(watch.channelId)!; if (BigInt(number) <= BigInt(current.lastMessageNumber)) return false; current.lastMessageNumber = number; jobs.add(`${watch.channelId}:${number}`); return true; },
    candidates: async () => connections.map((entry) => ({ connectionId: entry.id, sync: true, renew: true })),
  };
  const service = createSyncService(deps);
  return { deps, service, connections, watches, locks, jobs, failures, synced, renewed, background };
}

describe("retry policy", () => {
  it("backs off transient failures five times, then stops", async () => {
    const delays: number[] = []; let attempts = 0;
    await expect(withRetry(async () => { attempts++; throw { response: { status: 429 } }; }, { sleep: async (ms) => { delays.push(ms); }, random: () => 0.5 })).rejects.toEqual({ response: { status: 429 } });
    expect(attempts).toBe(6); expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  });
  it.each([400, 401, 403, 404])("does not retry permanent HTTP %i", async (status) => {
    let attempts = 0;
    await expect(withRetry(async () => { attempts++; throw { code: status }; })).rejects.toEqual({ code: status });
    expect(attempts).toBe(1);
  });
  it("uses jitter and recovers from a 503", async () => {
    const delays: number[] = []; let attempts = 0;
    expect(await withRetry(async () => { if (++attempts === 1) throw { status: 503 }; return "done"; }, { sleep: async (ms) => { delays.push(ms); }, random: () => 0 })).toBe("done");
    expect(delays).toEqual([500]);
  });
});

describe("orchestration", () => {
  it("requests the Drive files 24-hour maximum lifetime and retains a persisted channel on renewal", async () => {
    const f = fixture(); let requestedExpiration: Date | undefined;
    f.deps.createWatch = async (_connection, watch) => { requestedExpiration = watch.expiration; return { resourceId: "resource", expiration: watch.expiration }; };
    const result = await f.service.registerWatch("a");
    expect(requestedExpiration?.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(f.watches.get(result.channelId)?.resourceId).toBe("resource");
  });
  it("verifies channel token/resource and acknowledges without waiting for work; deduplicates large message numbers", async () => {
    const f = fixture(); const registered = await f.service.registerWatch("a");
    const watch = f.watches.get(registered.channelId)!;
    const request = (token = watch.token, resource = "resource") => new Request("https://example.com", { method: "POST", headers: { "x-goog-channel-id": watch.channelId, "x-goog-channel-token": token, "x-goog-resource-id": resource, "x-goog-resource-state": "update", "x-goog-message-number": "9007199254740993" } });
    expect((await notificationResponse(request("bad"), f.service, (task) => f.background.push(task))).status).toBe(403);
    expect((await notificationResponse(request(watch.token, "bad"), f.service, (task) => f.background.push(task))).status).toBe(403);
    expect((await notificationResponse(request(), f.service, (task) => f.background.push(task))).status).toBe(204);
    expect((await notificationResponse(request(), f.service, (task) => f.background.push(task))).status).toBe(204);
    expect(f.jobs.size).toBe(1); expect(f.synced).toEqual([]); expect(f.background).toHaveLength(1);
    await f.background[0](); expect(f.synced).toEqual(["a"]);
  });
  it("ignores unknown event states without creating work", async () => {
    const f = fixture();
    expect((await notificationResponse(new Request("https://example.com", { headers: { "x-goog-resource-state": "future-event" } }), f.service, (task) => f.background.push(task))).status).toBe(204);
    expect(f.jobs.size).toBe(0); expect(f.background).toHaveLength(0);
  });
  it("stops a newly created remote watch when activating it in storage fails", async () => {
    const f = fixture(); const stopped: string[] = [];
    const save = f.deps.saveWatch;
    f.deps.saveWatch = async (watch) => { if (watch.resourceId) throw new Error("storage unavailable"); await save(watch); };
    f.deps.stopWatch = async (watch) => { stopped.push(watch.resourceId!); };
    await expect(f.service.registerWatch("a")).rejects.toThrow("storage unavailable");
    expect(stopped).toEqual(["resource"]); expect(f.watches.size).toBe(0); expect(f.locks.size).toBe(0);
  });
  it("rejects expired channels without scheduling work", async () => {
    const f = fixture(); const registered = await f.service.registerWatch("a"); const watch = f.watches.get(registered.channelId)!;
    watch.expiration = new Date("2026-09-05");
    expect(await f.service.accept(new Headers({ "x-goog-resource-state": "update", "x-goog-channel-id": watch.channelId, "x-goog-channel-token": watch.token, "x-goog-resource-id": "resource", "x-goog-message-number": "2" }))).toEqual({ status: 403 });
    expect(f.jobs.size).toBe(0);
  });
  it("serializes the same connection and releases the lock after expired credentials", async () => {
    const f = fixture(); let unblock!: () => void;
    f.deps.execute = async () => { await new Promise<void>((resolve) => { unblock = resolve; }); throw { response: { status: 400, data: { error: "invalid_grant" } } }; };
    const first = f.service.runSheetSync("a", "manual");
    await new Promise((resolve) => setImmediate(resolve));
    await expect(f.service.runSheetSync("a", "notification")).rejects.toMatchObject({ code: "sync_busy" });
    unblock(); await expect(first).rejects.toMatchObject({ response: { status: 400 } });
    expect(f.failures).toEqual(["a:authorization_revoked"]); expect(f.locks.size).toBe(0);
  });
  it("continues sync and renewal batches after individual failures", async () => {
    const f = fixture();
    f.deps.execute = async (connection) => { if (connection.id === "a") throw { status: 401 }; f.synced.push(connection.id); return {} as never; };
    f.deps.createWatch = async (connection) => { if (connection.id === "a") throw { status: 404 }; f.renewed.push(connection.id); return { resourceId: "r", expiration: new Date("2026-09-07") }; };
    const result = await f.service.reconcile();
    expect(result).toEqual({ synced: 1, renewed: 1, failed: 2 }); expect(f.synced).toEqual(["b"]); expect(f.renewed).toEqual(["b"]);
  });
  it("lets other connections progress while one connection is waiting on Google", async () => {
    const f = fixture(); let unblock!: () => void;
    f.deps.execute = async (connection) => { if (connection.id === "a") await new Promise<void>((resolve) => { unblock = resolve; }); f.synced.push(connection.id); return {} as never; };
    const batch = f.service.reconcile();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.synced).toEqual(["b"]);
    unblock(); await batch; expect(f.synced).toEqual(["b", "a"]);
  });
  it("fails closed when cron secret is missing or bearer token is wrong", async () => {
    const f = fixture();
    expect((await reconcileResponse(new Request("https://example.com"), f.service, undefined)).status).toBe(503);
    expect((await reconcileResponse(new Request("https://example.com"), f.service, "secret")).status).toBe(401);
    expect((await reconcileResponse(new Request("https://example.com", { headers: { authorization: "Bearer secret" } }), f.service, "secret")).status).toBe(200);
  });
  it("requires administrator and same organization for manual sync", async () => {
    const f = fixture();
    expect((await manualSyncResponse("a", { role: "trainer", organizationId: "org" }, f.service)).status).toBe(403);
    expect((await manualSyncResponse("a", { role: "admin", organizationId: "other" }, f.service)).status).toBe(404);
    expect((await manualSyncResponse("a", { role: "admin", organizationId: "org" }, f.service)).status).toBe(200);
  });
});
