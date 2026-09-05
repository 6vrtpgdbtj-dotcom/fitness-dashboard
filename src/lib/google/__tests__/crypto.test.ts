import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenKey = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", tokenKey);
  vi.resetModules();
});

describe("Google token encryption", () => {
  it("keeps the plaintext out of ciphertext and decrypts the original token", async () => {
    const { decryptSecret, encryptSecret } = await import("@/lib/google/crypto");
    const secret = "google-refresh-token-that-must-not-leak";

    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("rejects a ciphertext whose authentication tag was tampered with", async () => {
    const { decryptSecret, encryptSecret } = await import("@/lib/google/crypto");
    const parts = encryptSecret("refresh-token").split(".");
    parts[1] = Buffer.alloc(16, 3).toString("base64url");

    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
