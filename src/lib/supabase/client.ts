"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export function createClient() {
  const { url, key } = getSupabaseConfig();
  let cached: { token: string; until: number } | null = null;
  let pending: Promise<string | null> | null = null;
  const accessToken = async (): Promise<string | null> => {
    if (cached && Date.now() < cached.until) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch("/api/realtime/token", { method: "POST", credentials: "same-origin", cache: "no-store" });
        if (!response.ok) { cached = null; return null; }
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("accessToken" in body) || !("expiresAt" in body) ||
          typeof body.accessToken !== "string" || !body.accessToken || typeof body.expiresAt !== "number" ||
          !Number.isFinite(body.expiresAt) || body.expiresAt * 1000 <= Date.now()) {
          cached = null; return null;
        }
        cached = { token: body.accessToken, until: Math.min(Date.now() + 20_000, body.expiresAt * 1000 - 60_000) };
        return cached.token;
      } catch {
        // Returning null clears Realtime's previous token; throwing would make
        // the SDK fall back to its cached token after an authorization failure.
        cached = null; return null;
      } finally { pending = null; }
    })();
    return pending;
  };
  // The supported accessToken option disables the SDK's browser Auth client:
  // no document.cookie/localStorage session or refresh token is ever needed.
  // Realtime calls it again on connection/heartbeat to renew channel auth.
  return createSupabaseClient(url, key, { accessToken });
}
