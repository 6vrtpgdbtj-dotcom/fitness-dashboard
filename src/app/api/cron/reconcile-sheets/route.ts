import { reconcileResponse } from "@/features/sync/http-handlers";
import { getSyncService } from "@/features/sync/production-runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) { return reconcileResponse(request, getSyncService(), process.env.CRON_SECRET); }
