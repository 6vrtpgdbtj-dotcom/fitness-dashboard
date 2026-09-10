// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGoogleAuthorizationUrl, createGoogleOAuthClient } from "../src/lib/google/oauth";

vi.mock("server-only", () => ({}));
beforeEach(() => {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) vi.stubEnv(key, undefined);
  vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://fitness.example/api/google/callback");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["canonical", "legacy", "both"])("builds the actual OAuth authorization request with %s deployment names", (mode) => {
  if (mode !== "legacy") {
    vi.stubEnv("GOOGLE_CLIENT_ID", "canonical-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "canonical-secret");
  }
  if (mode !== "canonical") {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "legacy-client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "legacy-secret");
  }
  const url = new URL(createGoogleAuthorizationUrl("nonce"));
  expect(url.searchParams.get("client_id")).toBe(mode === "legacy" ? "legacy-client" : "canonical-client");
  expect(url.searchParams.get("redirect_uri")).toBe("https://fitness.example/api/google/callback");
  // The SDK's token exchange must also receive the matching configured secret.
  expect(createGoogleOAuthClient()._clientSecret).toBe(mode === "legacy" ? "legacy-secret" : "canonical-secret");
});

it("fails closed when no client secret is configured", () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "canonical-client");
  expect(() => createGoogleAuthorizationUrl("nonce")).toThrow("Google OAuth is not configured.");
});
