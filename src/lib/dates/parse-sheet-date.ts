/** Calendar dates supported by both sheet profiling and ingestion. */
export function parseDate(value: string): string | null {
  const match = value.normalize("NFKC").trim().match(/^(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일|\.)?$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
