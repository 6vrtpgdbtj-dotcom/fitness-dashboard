import { constantTimeEqual, type SyncService } from "./orchestration";
import { classifySyncError } from "./retry-policy";
export async function notificationResponse(request: Request, service: SyncService, defer: (operation: () => Promise<void>) => void): Promise<Response> {
  try {
    const result = await service.accept(request.headers);
    if (result.connectionId) defer(async () => {
      try { await service.runSheetSync(result.connectionId!, "notification"); }
      catch { /* Durable pending/retry jobs are recovered by reconciliation. */ }
    });
    return new Response(null, { status: result.status });
  } catch { return new Response(null, { status: 503 }); }
}
export async function reconcileResponse(request: Request, service: SyncService, secret: string | undefined) {
  if (!secret) return Response.json({ error: "Cron is not configured." }, { status: 503 });
  if (!constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  try { return Response.json(await service.reconcile()); }
  catch { return Response.json({ error: "Reconciliation is unavailable." }, { status: 503 }); }
}
export async function manualSyncResponse(id: string, user: { role: string; organizationId: string }, service: SyncService) {
  if (user.role !== "admin") return new Response(null, { status: 403 });
  try {
    const connection = await service.getConnection(id);
    if (!connection || connection.organizationId !== user.organizationId) return new Response(null, { status: 404 });
    return Response.json(await service.runSheetSync(id, "manual"));
  } catch (error) { return Response.json({ error: classifySyncError(error).code }, { status: classifySyncError(error).code === "sync_busy" ? 409 : 502 }); }
}
