import { normalizeHeader } from "../mapping/header-normalizer";
import { canonicalFields } from "../mapping/canonical-fields";
import type { MappingDomain } from "../mapping/types";

/** Shared identity/amount/status fields cannot identify a domain on their own. */
export function discoverDomain(title: string, rows: unknown[][]): MappingDomain | null {
  const distinctive: Record<MappingDomain, string[]> = {
    member: ["birth_date", "phone_last4", "remaining_sessions", "total_registered_sessions", "total_paid_amount"],
    registration: ["external_registration_id", "registration_type", "product", "list_amount", "payment_method"],
    lead: ["external_lead_id", "lead_date", "consultation_date", "is_registered", "non_registration_reason"],
    class: ["external_class_id", "class_date", "starts_at", "deducted_sessions"],
  };
  const headers = new Set(rows.slice(0, 50).flat().filter((cell) => typeof cell === "string").map((cell) => normalizeHeader(String(cell))));
  const scores = (Object.keys(distinctive) as MappingDomain[]).map((domain) => {
    let score = canonicalFields[domain].filter((field) => distinctive[domain].includes(field.id) && [field.id, field.label, ...field.synonyms].some((alias) => headers.has(normalizeHeader(alias)))).length * 2;
    const titles = { member: /회원|member/i, registration: /등록|결제|매출|registration/i, lead: /상담|문의|lead/i, class: /수업|출석|시간표|class/i };
    if (titles[domain].test(title)) score++;
    return { domain, score };
  }).sort((a, b) => b.score - a.score);
  return scores[0].score > 0 && scores[0].score > scores[1].score ? scores[0].domain : null;
}
