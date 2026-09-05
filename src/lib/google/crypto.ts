import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const encoding = "base64url";

function encryptionKey() {
  const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured.");

  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString(encoding)).join(".");
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue, ...extra] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue || extra.length > 0) throw new Error("Malformed encrypted secret.");

  const iv = Buffer.from(ivValue, encoding);
  const tag = Buffer.from(tagValue, encoding);
  const ciphertext = Buffer.from(ciphertextValue, encoding);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Malformed encrypted secret.");

  const decipher = createDecipheriv(algorithm, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
