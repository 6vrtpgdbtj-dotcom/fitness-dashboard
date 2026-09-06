import "server-only";
import { getSyncService } from "./production-runtime";
import type { SyncReason } from "./orchestration";
export type { SyncReason } from "./orchestration";
export type { SyncResult } from "./types";
export function runSheetSync(connectionId: string, reason: SyncReason) { return getSyncService().runSheetSync(connectionId, reason); }
