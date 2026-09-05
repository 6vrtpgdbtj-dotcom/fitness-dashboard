export function normalizeHeader(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/[\s\p{P}\p{S}]+/gu, "");
}
