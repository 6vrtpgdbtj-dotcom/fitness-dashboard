// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";
import { signInWithGoogle } from "@/app/login/actions";
import { middleware } from "@/middleware";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), maybeSingle: vi.fn(), exchangeCodeForSession: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn(), refreshCookies: false,
}));
vi.mock("server-only", () => ({}));
function fakeClient() {
  return {
    auth: mocks,
    from: (table: string) => {
      if (table !== "profiles") throw new Error("Unexpected table");
      return { select: () => ({ eq: (column: string, value: string) => {
        if (column !== "id" || value !== "u1") throw new Error("Wrong profile");
        return { maybeSingle: mocks.maybeSingle };
      } }) };
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (values: object[]) => void } }) => {
  if (mocks.refreshCookies) options.cookies.setAll([{ name: "sb-test", value: "refreshed", options: { httpOnly: true, path: "/" } }]);
  return fakeClient();
} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon");
  mocks.refreshCookies = false;
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: { id: "u1", organization_id: "o1", role: "admin", trainer_id: null, is_active: true }, error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.signInWithOAuth.mockImplementation((options) => {
    if (options.provider !== "google" || options.options.redirectTo !== "https://fitness.example/auth/callback") throw new Error("Wrong OAuth configuration");
    return { data: { url: "https://test.supabase.co/auth/v1/authorize?provider=google" }, error: null };
  });
});

describe("Google login", () => {
  it("starts Google OAuth with the configured callback", async () => {
    await expect(signInWithGoogle()).rejects.toThrow("redirect:https://test.supabase.co/auth/v1/authorize?provider=google");
  });
  it("shows a safe login error when OAuth fails", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: new Error("secret provider detail") });
    await expect(signInWithGoogle()).rejects.toThrow("redirect:/login?error=oauth");
  });
  it("exchanges the code and sends an approved user to the dashboard", async () => {
    mocks.exchangeCodeForSession.mockImplementation((code) => {
      if (code !== "valid-code") throw new Error("Wrong code");
      return { data: {}, error: null };
    });
    const response = await GET(new NextRequest("https://untrusted.example/auth/callback?code=valid-code&next=https://evil.example"));
    expect(response.headers.get("location")).toBe("https://fitness.example/dashboard");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["", "?error=access_denied"]) ("rejects callbacks without a code (%s)", async (query) => {
    const response = await GET(new NextRequest(`https://fitness.example/auth/callback${query}`));
    expect(response.headers.get("location")).toBe("https://fitness.example/login?error=oauth");
  });
  it("rejects an invalid exchange code", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error("expired code") });
    expect((await GET(new NextRequest("https://fitness.example/auth/callback?code=expired"))).headers.get("location"))
      .toBe("https://fitness.example/login?error=oauth");
  });
  it("blocks authenticated users without an approved profile", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(new NextRequest("https://fitness.example/auth/callback?code=valid"))).headers.get("location"))
      .toBe("https://fitness.example/login?error=not-approved");
  });
});

describe("dashboard middleware", () => {
  it.each(["/dashboard", "/dashboard/detail", "/members", "/registrations", "/leads", "/classes", "/settings/sheets", "/settings/users"])
    ("protects %s from unauthenticated access", async (path) => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const response = await middleware(new NextRequest(`https://fitness.example${path}?private=hidden`));
      expect(response.headers.get("location")).toBe("https://fitness.example/login");
    });
  it("rejects inactive profiles", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "u1", organization_id: "o1", role: "admin", is_active: false }, error: null });
    expect((await middleware(new NextRequest("https://fitness.example/dashboard"))).headers.get("location"))
      .toBe("https://fitness.example/login?error=not-approved");
  });
  it("blocks trainers from administrator settings", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "u1", organization_id: "o1", role: "trainer", trainer_id: "t1", is_active: true }, error: null });
    expect((await middleware(new NextRequest("https://fitness.example/settings/sheets"))).headers.get("location"))
      .toBe("https://fitness.example/dashboard");
  });
  it("preserves refreshed cookies on successful requests", async () => {
    mocks.refreshCookies = true;
    const response = await middleware(new NextRequest("https://fitness.example/dashboard"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-test")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("preserves refreshed cookies when redirecting an unapproved user", async () => {
    mocks.refreshCookies = true;
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await middleware(new NextRequest("https://fitness.example/dashboard"));
    expect(response.cookies.get("sb-test")?.value).toBe("refreshed");
    expect(response.headers.get("location")).toContain("not-approved");
  });
  it("fails closed with a setup message when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await middleware(new NextRequest("https://fitness.example/dashboard"));
    expect(response.headers.get("location")).toBe("https://fitness.example/login?error=configuration");
  });
});
