import type { ColumnProfile, ValueKind } from "./types";
import { parseDate } from "@/lib/dates/parse-sheet-date";

const statuses = new Set(["상담완료", "상담예정", "미등록", "등록", "등록완료", "신규", "재등록", "완료", "예정", "진행중", "활성", "종료", "휴면", "중단", "취소", "환불", "결석", "출석", "노쇼", "이용중", "true", "false", "yes", "no", "y", "n"]);
export function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function classify(value: unknown): ValueKind {
  if (value instanceof Date && Number.isFinite(value.getTime())) return "date";
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "integer" : "money";
  const text = String(value).normalize("NFKC").trim();
  if (parseDate(text)) return "date";
  if (statuses.has(text.toLowerCase().replace(/\s/g, ""))) return "status";
  if (/^[+-]?\d+(?:\.\d+)?\s*%$/.test(text)) return "percentage";
  if (/^0\d+$/.test(text) || /^(?:[a-z]+[-_]?\d+[\w-]*|\d{2,4}-\d{3,4}-\d{4})$/i.test(text)) return "identifier";
  if (/^[+-]?\d+$/.test(text)) return "integer";
  if (/^[₩$€]?\s*[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:원|krw|usd)?$/i.test(text)) return "money";
  return "freeText";
}

export function profileColumn(values: unknown[]): ColumnProfile {
  const counts: Record<ValueKind, number> = { date: 0, integer: 0, money: 0, percentage: 0, status: 0, identifier: 0, freeText: 0 };
  const populated = values.filter(isNonEmpty);
  for (const value of populated) counts[classify(value)]++;
  const kinds = Object.keys(counts) as ValueKind[];
  const kind = kinds.reduce((best, next) => counts[next] > counts[best] ? next : best, kinds[0]);
  return {
    kind: populated.length ? kind : "empty",
    nonEmptyCount: populated.length,
    confidence: populated.length ? counts[kind] / populated.length : 0,
    ratios: Object.fromEntries(kinds.map((key) => [key, populated.length ? counts[key] / populated.length : 0])) as Record<ValueKind, number>,
  };
}

/** Never expose full telephone values in mapping previews. */
export function sampleValue(value: unknown): string {
  return String(value).replace(/(?:\+82[- ]?|0)1[016789][- ]?\d{3,4}[- ]?(\d{4})/g, "***-****-$1").slice(0, 100);
}
