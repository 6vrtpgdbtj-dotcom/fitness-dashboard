// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/realtime/token/route";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), session: vi.fn(), create: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("../src/lib/auth/user-scope", () => ({ readUserScope: mocks.scope }));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example");
  mocks.create.mockResolvedValue({ auth: { getSession: mocks.session } });
  mocks.scope.mockResolvedValue({ user: { id: "approved", role: "trainer", trainerId: "trainer" }, error: null });
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "approved" }, access_token: "access-only", refresh_token: "never-expose", expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
const request = (origin = "https://fitness.example") => new Request("https://fitness.example/api/realtime/token", { method: "POST", headers: { origin } });
it("hands off only an expiring access token after verified active-profile authorization", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ accessToken: "access-only", expiresAt: expect.any(Number) });
  expect(mocks.scope.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
});
it.each(["https://evil.example", "null", ""])("denies origin %s before touching session", async (origin) => {
  expect((await POST(request(origin))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(["unauthenticated", "not-approved"])("denies %s without exposing a session", async (error) => {
  mocks.scope.mockResolvedValue({ user: null, error });
  const response = await POST(request());
  expect(response.status).toBe(error === "unauthenticated" ? 401 : 403);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.session).not.toHaveBeenCalled();
});
it.each([
  null,
  { user: { id: "other" }, access_token: "token", expires_at: 9_999_999_999 },
  { user: { id: "approved" }, access_token: "token", expires_at: 1 },
])("rejects missing, mismatched or expired sessions", async (session) => {
  mocks.session.mockResolvedValue({ data: { session }, error: null });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("token");
});
it("returns a generic no-store failure on infrastructure errors", async () => {
  mocks.create.mockRejectedValueOnce(new Error("secret details"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.text()).not.toContain("secret details");
});
