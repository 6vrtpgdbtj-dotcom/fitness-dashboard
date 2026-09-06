import { after } from "next/server";
import { notificationResponse } from "@/features/sync/http-handlers";
import { getSyncService } from "@/features/sync/production-runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) { return notificationResponse(request, getSyncService(), after); }
