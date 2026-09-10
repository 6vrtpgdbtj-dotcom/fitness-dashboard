// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import nock from "nock";
import { createClient } from "../src/lib/supabase/server";
const jar = vi.hoisted(() => ({ writes: [] as Array<{ name: string; value: string; options: { httpOnly?: boolean; secure?: boolean; sameSite?: string } }> }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: (name: string, value: string, options: typeof jar.writes[number]["options"]) => jar.writes.push({ name, value, options }) }) }));
beforeEach(() => { jar.writes = []; vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://cookie-test.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example"); });
afterEach(() => { nock.cleanAll(); vi.unstubAllEnvs(); });
it("persists a real SDK session through the server adapter using only HttpOnly Secure cookies", async () => {
  const user = { id: "approved-user", aud: "authenticated", role: "authenticated", email: "qa@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  nock("https://cookie-test.supabase.co").get("/auth/v1/user").reply(200, user);
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const signature = Buffer.from("fixture-signature").toString("base64url");
  const session = await (await createClient()).auth.setSession({ access_token: `e30.${payload}.${signature}`, refresh_token: "fixture-refresh-not-a-real-token" });
  expect(session.error).toBeNull();
  expect(jar.writes.length).toBeGreaterThan(0);
  for (const cookie of jar.writes) {
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
  }
});

it("refreshes an expired session through the real server SDK and retains HttpOnly on rotated cookies", async () => {
  const user = { id: "approved-user", aud: "authenticated", role: "authenticated", email: "qa@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const jwt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp })).toString("base64url")}.${Buffer.from("signature").toString("base64url")}`;
  const renewed = jwt(Math.floor(Date.now() / 1000) + 3600);
  const refresh = nock("https://cookie-test.supabase.co").post("/auth/v1/token?grant_type=refresh_token", { refresh_token: "expired-session-refresh" }).reply(200, {
    access_token: renewed, refresh_token: "rotated-server-only-refresh", token_type: "bearer", expires_in: 3600, user,
  });
  const session = await (await createClient()).auth.setSession({ access_token: jwt(1), refresh_token: "expired-session-refresh" });
  expect(session.error).toBeNull();
  expect(session.data.session?.access_token).toBe(renewed);
  expect(refresh.isDone()).toBe(true);
  expect(jar.writes.length).toBeGreaterThan(0);
  expect(jar.writes.every(({ options }) => options.httpOnly === true && options.secure === true)).toBe(true);
});
