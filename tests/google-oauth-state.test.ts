// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/google/callback/route";
const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: "admin", role: "admin" }) }));
vi.mock("@/lib/google/oauth", () => ({ createGoogleOAuthClient: () => ({ getToken: exchange }), saveGoogleCredentials: async () => {} }));
vi.mock("@/lib/google/sheets", () => ({ getOrganizationId: async () => "org" }));
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example"); exchange.mockReset().mockResolvedValue({ tokens: {} }); });
it.each(["state=wrong&code=test", "state=expected", "state=expected&code=test&error=access_denied"])("consumes failed OAuth state without token exchange: %s", async (query) => {
  const response = await GET(new NextRequest(`https://fitness.example/api/google/callback?${query}`, { headers: { cookie: "google_oauth_state=expected" } }));
  expect(response.headers.get("location")).toBe("https://fitness.example/settings/sheets?error=oauth");
  expect(response.cookies.get("google_oauth_state")?.value).toBe("");
  expect(exchange).not.toHaveBeenCalled();
});
it("clears state and uses canonical origin when token exchange fails", async () => {
  exchange.mockRejectedValue(new Error("private provider detail"));
  const response = await GET(new NextRequest("https://untrusted.example/api/google/callback?state=expected&code=test", { headers: { cookie: "google_oauth_state=expected" } }));
  expect(response.headers.get("location")).toBe("https://fitness.example/settings/sheets?error=oauth");
  expect(response.cookies.get("google_oauth_state")?.value).toBe("");
});
