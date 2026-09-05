import { createHash } from "node:crypto";

/** Length/delimiter-safe JSON encoding and deterministic object key ordering. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function sourceRecordKey(connectionId: string, tabId: string, canonicalIdentity: string): string {
  return fingerprint([connectionId, tabId, canonicalIdentity]);
}
