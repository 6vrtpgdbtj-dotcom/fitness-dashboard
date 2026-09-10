// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { createClient } from "../src/lib/supabase/server";
import { middleware } from "../src/middleware";
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [...jar.cookies].map(([name, value]) => ({ name, value })), set: (name: string, value: string) => { if (value) jar.cookies.set(name, value); else jar.cookies.delete(name); } }) }));
beforeEach(() => { jar.cookies.clear(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://logout-test.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example"); });
afterEach(() => { nock.cleanAll(); vi.unstubAllEnvs(); });

it("clears the server session, redirects to login and refuses subsequent protected access", async () => {
  const user = { id: "approved-user", aud: "authenticated", role: "authenticated", email: "qa@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const jwt = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.c2lnbmF0dXJl`;
  nock("https://logout-test.supabase.co").get("/auth/v1/user").reply(200, user);
  expect((await (await createClient()).auth.setSession({ access_token: jwt, refresh_token: "fixture-refresh" })).error).toBeNull();
  expect(jar.cookies.size).toBeGreaterThan(0);
  const logout = nock("https://logout-test.supabase.co", { reqheaders: { authorization: `Bearer ${jwt}` } }).post("/auth/v1/logout?scope=local").reply(204);
  const { POST } = await import("../src/app/auth/signout/route");
  const response = await POST(new Request("https://fitness.example/auth/signout?next=https://evil.example", { method: "POST", headers: { origin: "https://fitness.example" } }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://fitness.example/login");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(logout.isDone()).toBe(true);
  expect(jar.cookies.size).toBe(0);
  expect((await middleware(new NextRequest("https://fitness.example/dashboard"))).headers.get("location")).toBe("https://fitness.example/login");
});

it("rejects cross-origin sign-out before accessing the session", async () => {
  const { POST } = await import("../src/app/auth/signout/route");
  expect((await POST(new Request("https://fitness.example/auth/signout", { method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
});
