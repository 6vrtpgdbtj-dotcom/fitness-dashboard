import { canonicalFields } from "../mapping/canonical-fields";
import { parseDate } from "@/lib/dates/parse-sheet-date";
export { parseDate } from "@/lib/dates/parse-sheet-date";
import type { MappingDomain } from "../mapping/types";
import type { CanonicalRow, FieldIssue, NormalizedRow, NormalizedValues } from "./types";

export function redactPhones(text: string): string {
  // Tokenize whole digit groups instead of enumerating every punctuation/prefix
  // combination. Bounded windows also find phones beside dates or other numbers.
  const groups = [...text.matchAll(/\(?\+?\d+\)?/g)];
  let output = "";
  let copiedUntil = 0;
  for (let first = 0; first < groups.length; first++) {
    const start = groups[first].index!;
    // Avoid cutting an ASCII identifier, date component or currency amount.
    if (/(?:[A-Za-z0-9_][-./]?|[₩$])$/.test(text.slice(Math.max(0, start - 2), start))) continue;
    for (let last = first; last < groups.length && last < first + 6; last++) {
      if (last > first) {
        const previousEnd = groups[last - 1].index! + groups[last - 1][0].length;
        if (!/^[ \t./-]*$/.test(text.slice(previousEnd, groups[last].index))) break;
      }
      const end = groups[last].index! + groups[last][0].length;
      const candidate = text.slice(start, end);
      let digits = candidate.replace(/\D/g, "");
      if (digits.length > 15) break;
      if (/^\d+\.\d+$/.test(candidate) || /[A-Za-z0-9_원₩$]/.test(text.slice(end, end + 1))) continue;
      if (candidate.includes("+")) {
        if (!/^\(?\+82/.test(candidate)) continue;
        // +82 (0)10..., +82 10..., and +82 010... have one domestic trunk zero.
        digits = `0${digits.slice(2).replace(/^0/, "")}`;
      }
      const domestic = /^0[1-9]\d{7,9}$/.test(digits);
      // National service numbers use a visible 4+4 grouping. Do not erase bare
      // eight-digit prices/IDs just because they start with 1.
      const service = /^1[568]\d{6}$/.test(digits) && last === first + 1
        && /^\d{4}$/.test(groups[first][0]) && /^\d{4}$/.test(groups[last][0]);
      if (!domestic && !service) continue;
      output += `${text.slice(copiedUntil, start)}[전화번호 삭제]`;
      copiedUntil = end;
      first = last;
      break;
    }
  }
  return output + text.slice(copiedUntil);
}
function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const result = String(value).normalize("NFKC").trim();
  return result || null;
}
function parseNumber(value: string): number | null {
  const clean = value.replace(/^(?:₩|￦|\$|KRW)\s*/i, "").replace(/\s*(?:원|KRW)$/i, "").trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean)) return null;
  const result = Number(clean.replaceAll(",", ""));
  return Number.isFinite(result) && Math.abs(result) < 1e12 ? result : null;
}
const statusAliases: Record<MappingDomain, Record<string, string>> = {
  member: { active: "active", 진행중: "active", 진행: "active", 이용중: "active", 활성: "active", 휴회: "paused", 중지: "paused", paused: "paused", 종료: "ended", 만료: "ended", ended: "ended", 탈퇴: "inactive", inactive: "inactive" },
  registration: { paid: "paid", 결제완료: "paid", 완료: "paid", 정상: "paid", pending: "pending", 미결제: "pending", 대기: "pending", refunded: "refunded", 환불: "refunded", cancelled: "cancelled", 취소: "cancelled" },
  lead: { new: "new", 신규: "new", 문의: "new", 상담예정: "scheduled", 예약: "scheduled", scheduled: "scheduled", 상담완료: "consulted", consulted: "consulted", 등록: "registered", 등록완료: "registered", registered: "registered", 미등록: "not_registered", not_registered: "not_registered", 취소: "cancelled", cancelled: "cancelled" },
  class: { 출석: "completed", 완료: "completed", 수업완료: "completed", completed: "completed", 예약: "scheduled", 예정: "scheduled", scheduled: "scheduled", 취소: "cancelled", cancelled: "cancelled", 결석: "no_show", 노쇼: "no_show", no_show: "no_show" },
};
const categories: Record<string, string> = { 신규: "new", 첫등록: "new", new: "new", 재등록: "renewal", 연장: "renewal", renewal: "renewal", 추가: "additional", 추가등록: "additional", additional: "additional" };
const dates = new Set(["birth_date", "first_consultation_date", "first_registration_date", "latest_registration_date", "expected_end_date", "registration_date", "lead_date", "consultation_date", "class_date"]);
const numeric = new Set(["remaining_sessions", "total_registered_sessions", "total_paid_amount", "registered_sessions", "list_amount", "paid_amount", "price_per_session", "discount_amount", "deducted_sessions"]);
const hintFields = new Set(["name", "external_member_id", "trainer_name", "sales_trainer_name"]);
// Only supplementary fields may be discarded without losing business identity,
// the paid amount/date, attendance, conversion, or trainer authorization.
const warningFields = new Set(["expected_end_date", "first_consultation_date", "first_registration_date", "latest_registration_date", "list_amount", "price_per_session", "discount_amount"]);

export function normalizeFields(domain: MappingDomain, row: CanonicalRow): NormalizedRow {
  const values: NormalizedValues = {};
  const hints: NormalizedRow["hints"] = {};
  const issues: FieldIssue[] = [];
  const issue = (field: string, code: string) => issues.push({ field, code, message: `${field}: ${code}`, ...(warningFields.has(field) ? { severity: "warning" as const } : {}) });
  for (const { id } of canonicalFields[domain]) {
    if (!(id in row)) continue;
    const original = text(row[id]);
    if (original === null) {
      if (row[id] != null && typeof row[id] !== "string") issue(id, "invalid_value");
      if (!hintFields.has(id) || (domain === "member" && (id === "name" || id === "external_member_id"))) values[id] = null;
      continue;
    }
    const value = redactPhones(original);
    if (hintFields.has(id)) {
      hints[id as keyof typeof hints] = value;
      if (domain === "member" && (id === "name" || id === "external_member_id")) values[id] = value;
    } else if (dates.has(id)) {
      values[id] = parseDate(original);
      if (values[id] === null) issue(id, "invalid_date");
    } else if (numeric.has(id)) {
      values[id] = parseNumber(original);
      if (values[id] === null) issue(id, "invalid_number");
      else if ((values[id] as number) < 0 || (id.endsWith("sessions") && (values[id] as number) >= 1e8)) { values[id] = null; issue(id, "out_of_range"); }
    } else if (id === "phone_last4") {
      const digits = original.replace(/\D/g, "");
      values[id] = digits.length >= 4 ? digits.slice(-4) : null;
      if (values[id] === null) issue(id, "invalid_phone");
    } else if (id === "status" || id === "registration_type") {
      values[id] = (id === "status" ? statusAliases[domain] : categories)[original.toLowerCase().replace(/\s/g, "")] ?? null;
      if (values[id] === null) issue(id, "unknown_category");
    } else if (id === "is_registered") {
      if (["true", "1", "예", "네", "등록", "등록완료", "y", "yes", "o"].includes(original.toLowerCase())) values[id] = true;
      else if (["false", "0", "아니오", "아니요", "미등록", "n", "no", "x"].includes(original.toLowerCase())) values[id] = false;
      else { values[id] = null; issue(id, "invalid_boolean"); }
    } else if (id !== "starts_at") values[id] = value;
  }
  if (domain === "class" && text(row.starts_at)) {
    const start = text(row.starts_at)!;
    const local = start.match(/^(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (local && values.class_date) {
      let hour = Number(local[2]);
      const validHour = local[1] ? hour >= 1 && hour <= 12 : hour <= 23;
      if (local[1]) hour = hour % 12 + (local[1] === "오후" ? 12 : 0);
      if (validHour && Number(local[3]) < 60 && Number(local[4] ?? 0) < 60) values.starts_at = new Date(`${values.class_date}T${String(hour).padStart(2, "0")}:${local[3]}:${local[4] ?? "00"}+09:00`).toISOString();
    } else if (/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(start) && parseDate(start.slice(0, 10)) && Number.isFinite(Date.parse(start))) values.starts_at = new Date(start).toISOString();
    if (!values.starts_at) { values.starts_at = null; issue("starts_at", "invalid_time"); }
  }
  if (!hints.name && !hints.external_member_id) issue("name", "required");
  const required = domain === "registration" ? ["registration_date", "paid_amount"] : domain === "class" ? ["class_date"] : [];
  for (const field of required) if (values[field] == null && !issues.some((entry) => entry.field === field)) issue(field, "required");
  const memberKey = hints.external_member_id ? ["member_id", hints.external_member_id] : hints.name ? ["name", hints.name] : null;
  const external = values[`external_${domain}_id`];
  let identity: unknown[] | null = external ? [domain, "external", external] : null;
  if (!identity && memberKey) {
    if (domain === "member") identity = [domain, memberKey, values.phone_last4 ?? null, values.birth_date ?? null];
    if (domain === "registration" && values.registration_date) identity = [domain, memberKey, values.registration_date, values.product ?? null];
    if (domain === "lead" && (values.lead_date || values.consultation_date)) identity = [domain, memberKey, values.lead_date ?? values.consultation_date];
    if (domain === "class" && values.class_date) identity = [domain, memberKey, values.class_date, values.starts_at ? new Date(String(values.starts_at)).toISOString() : null];
  }
  if (!identity) issue("identity", "missing_identity");
  return { values, hints, canonicalIdentity: identity ? JSON.stringify(identity) : null, issues };
}
