import type { MappingDomain, ValueKind } from "./types";

export type CanonicalField = { id: string; label: string; synonyms: readonly string[]; kinds: readonly ValueKind[] };
const field = (id: string, label: string, synonyms: string[], kinds: ValueKind[] = ["freeText"]): CanonicalField => ({ id, label, synonyms, kinds });
const identity = [
  field("name", "회원명", ["고객명", "성명", "이름", "회원이름", "member name"]),
  field("external_member_id", "회원ID", ["회원번호", "고객번호", "고객ID", "member id"], ["identifier", "integer", "freeText"]),
  field("trainer_name", "담당트레이너", ["담당자", "담당코치", "트레이너", "코치"]),
];
// Some real workbooks use lifecycle-looking labels (for example "재등록")
// inside the acquisition/source column. The header determines the business
// meaning here, so both ordinary text and status-shaped values are valid.
const acquisition = field("acquisition_source", "유입경로", ["가입경로", "유입채널", "방문경로"], ["freeText", "status"]);
const goal = field("exercise_goal", "운동목표", ["운동목적", "상담목적"]);
const paid = field("paid_amount", "실결제금액", ["결제액", "매출", "결제금액", "실결제액", "입금액"], ["money", "integer"]);
const registered = field("registered_sessions", "등록횟수", ["등록회차", "등록수업수", "등록세션", "세션"], ["integer"]);
const registrationDate = field("registration_date", "등록일", ["등록날짜", "결제일", "결제날짜", "등록일자"], ["date"]);
const remaining = field("remaining_sessions", "잔여횟수", ["남은횟수", "잔여수업", "잔여세션"], ["integer"]);
const endDate = field("expected_end_date", "종료예정일", ["만료일", "종료일", "예상종료일"], ["date"]);

/** IDs match normalized storage where possible; name/trainer_name are ingestion join hints. */
export const canonicalFields: Record<MappingDomain, readonly CanonicalField[]> = {
  member: [...identity, acquisition, goal, remaining, endDate,
    field("gender", "성별", ["gender"]),
    field("birth_date", "생년월일", ["생일", "출생일"], ["date"]),
    field("phone_last4", "전화뒤4자리", ["전화끝4자리", "연락처뒤4자리", "전화번호", "연락처", "휴대폰"], ["identifier", "integer"]),
    field("first_consultation_date", "최초상담일", ["첫상담일"], ["date"]),
    field("first_registration_date", "최초등록일", ["첫등록일", "가입일"], ["date"]),
    field("latest_registration_date", "최근등록일", ["마지막등록일"], ["date"]),
    field("status", "회원상태", ["상태", "진행상태"], ["status", "freeText"]),
    field("total_registered_sessions", "누적등록횟수", ["총등록횟수"], ["integer"]),
    field("total_paid_amount", "누적결제금액", ["총결제금액", "누적매출"], ["money", "integer"]),
    field("referrer", "추천인", ["소개자"]), field("notes", "메모", ["비고", "특이사항"]),
  ],
  registration: [...identity, acquisition, paid, registered, registrationDate, endDate,
    field("external_registration_id", "등록ID", ["등록번호", "결제번호"], ["identifier", "integer", "freeText"]),
    field("registration_type", "등록구분", ["등록유형", "신규재등록", "구분", "renew", "renewal"], ["status", "freeText"]),
    field("product", "상품", ["상품명", "등록상품", "프로그램"]),
    field("list_amount", "정가", ["정상금액", "정가금액"], ["money", "integer"]),
    field("price_per_session", "회당단가", ["회당금액", "수업단가"], ["money", "integer"]),
    field("discount_amount", "할인금액", ["할인액"], ["money", "integer"]),
    field("payment_method", "결제수단", ["결제방법", "결제방식"]),
    field("sales_trainer_name", "판매트레이너", ["판매담당자", "영업담당자"]),
    field("status", "결제상태", ["등록상태", "상태"], ["status", "freeText"]),
  ],
  lead: [...identity, acquisition, goal, paid, registered, registrationDate,
    field("external_lead_id", "상담ID", ["상담번호", "문의번호"], ["identifier", "integer", "freeText"]),
    field("lead_date", "유입일", ["문의일", "유입날짜", "문의일자"], ["date"]),
    field("consultation_date", "상담일", ["상담일자", "상담날짜"], ["date"]),
    field("status", "상담상태", ["상담결과", "상태"], ["status", "freeText"]),
    field("is_registered", "등록여부", ["전환여부", "등록전환"], ["status"]),
    field("non_registration_reason", "미등록사유", ["미등록이유", "거절사유"]),
  ],
  class: [...identity, remaining,
    field("external_class_id", "수업ID", ["수업번호", "예약번호"], ["identifier", "integer", "freeText"]),
    field("class_date", "수업일", ["수업날짜", "수업일자"], ["date"]),
    field("starts_at", "수업시작시간", ["시작시간", "예약시간"], ["date", "freeText"]),
    field("deducted_sessions", "차감횟수", ["차감회차", "사용횟수"], ["integer"]),
    field("status", "수업상태", ["출석상태", "출결", "상태"], ["status", "freeText"]),
  ],
};

/** Identity can use an external member key or a name; row-level validation is downstream. */
export function missingRequiredFields(domain: MappingDomain, fields: readonly (string | null)[]): string[] {
  const missing = fields.includes("name") || fields.includes("external_member_id") ? [] : ["name"];
  const requiredDate = domain === "registration" ? "registration_date" : domain === "class" ? "class_date" : null;
  if (requiredDate && !fields.includes(requiredDate)) missing.push(requiredDate);
  return missing;
}
