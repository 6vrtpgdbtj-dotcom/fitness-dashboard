"use client";
import { useState } from "react";
import { canonicalFields } from "@/features/mapping/canonical-fields";
import type { MemberCandidate, ReviewRecord } from "@/features/admin/types";
import { useAdminMutation } from "./use-admin-mutation";
import { ConfirmationDialog } from "./confirmation-dialog";
const domainLabels = { member: "회원", registration: "등록", lead: "상담", class: "수업" };
const matchLabels: Record<string, string> = { external_member_id: "회원ID", name: "회원명", phone_last4: "전화 뒤4자리", birth_date: "생년월일" };
const issueLabels: Record<string,string> = { required:"필수 값 누락",unmapped_required:"필수 열 미연결",missing_header:"헤더 확인 필요",duplicate_identity:"원본 식별자 중복",missing_identity:"회원 식별 정보 부족",invalid_date:"날짜 형식 확인",invalid_number:"숫자 형식 확인",out_of_range:"허용 범위 초과",invalid_phone:"전화 뒤 4자리 확인",unknown_category:"상태 값 확인",invalid_boolean:"등록 여부 확인",invalid_time:"수업 시간 확인",invalid_value:"값 형식 확인" };
export function RecordReviewTable({ records, members }: { records: ReviewRecord[]; members: MemberCandidate[] }) {
  const [filter, setFilter] = useState("review_required");
  const filtered = records.filter(r => r.record_status === filter);
  return <section className="admin-section" aria-labelledby="review-title"><div className="admin-section-heading"><div><p className="eyebrow">REVIEW QUEUE</p><h2 id="review-title">확인이 필요한 데이터</h2></div><label className="admin-field">표시 상태<select value={filter} onChange={e => setFilter(e.target.value)}><option value="review_required">검토 필요</option><option value="rejected">제외한 기록</option></select></label></div>
    <p className="form-hint">분야별 최근 100건을 표시합니다. 수정값은 다음 동기화에도 유지됩니다. 검토를 마친 기록만 승인해 주세요.</p>
    {filtered.length ? <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="데이터 점검 표, 좌우 스크롤"><table className="admin-table"><thead><tr><th scope="col">기록 / 원본</th><th scope="col">헤더 · 예시 값</th><th scope="col">점검 사유</th><th scope="col">관리자 작업</th></tr></thead><tbody>{filtered.map(record => <ReviewRow key={record.id} record={record} members={members} />)}</tbody></table></div> : <p className="admin-empty">이 상태의 점검 항목이 없습니다.</p>}
  </section>;
}
function ReviewRow({ record, members }: { record: ReviewRecord; members: MemberCandidate[] }) {
  const [open, setOpen] = useState(false), [field, setField] = useState(record.issues[0]?.field ?? "status"), [value, setValue] = useState(""), [retainedId, setRetained] = useState(""), [merging, setMerging] = useState(false);
  const state = useAdminMutation();
  const fields = canonicalFields[record.domain].filter(f => !["trainer_name", "sales_trainer_name", ...(record.domain === "member" ? [] : ["name", "external_member_id"])].includes(f.id));
  const selected = fields.some(f => f.id === field) ? field : fields[0].id;
  const candidate = members.find(m => m.id === retainedId);
  const duplicateCandidates = record.issues.find(issue => issue.code === "duplicate_member_candidate")?.candidates ?? [];
  const mutate = (body: object) => state.mutate(`/api/review/${record.id}`, body);
  return <tr><th scope="row"><strong>{String(record.name ?? domainLabels[record.domain])}</strong><small>{record.tab_title}</small><small>{record.id.slice(0,8)}</small></th>
    <td>{record.issues.length ? record.issues.map(issue => <div key={`${issue.field}:${issue.code}`}>{record.source_fields.find(f => f.field === issue.field)?.sourceHeader ?? issue.field}<small>{String(record[issue.field] ?? "값 확인 필요")}</small></div>) : "관리자 확인 필요"}</td>
    <td>{record.issues.map(issue => <span className="admin-issue" key={`${issue.field}:${issue.code}`}>{issue.code === "duplicate_member_candidate" ? "조직 내 중복 회원 후보" : issueLabels[issue.code] ?? "원본 값 확인"}</span>)}{!record.issues.length && "매핑·담당자 확인"}{duplicateCandidates.map(match => <p key={match.memberId}>{members.find(member => member.id === match.memberId)?.name ?? match.memberId.slice(0,8)} · {match.score}점<small>{match.reasons.map(reason => matchLabels[reason] ?? reason).join(" · ")}</small></p>)}</td>
    <td><button className="quiet-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "닫기" : "검토"}</button>{open && <div className="admin-review-form">
      <label className="admin-field">수정 필드<select value={selected} disabled={state.busy} onChange={e => { setField(e.target.value); setValue(""); }}>{fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <label className="admin-field">수정값<input value={value} disabled={state.busy} maxLength={2000} onChange={e => setValue(e.target.value)} placeholder="빈 값은 지움" /></label>
      <button className="quiet-button" disabled={state.busy} onClick={() => mutate({ action: "correct", domain: record.domain, fields: { [selected]: value || null } })}>수정 저장</button>
      {duplicateCandidates.length > 0 && <p className="form-hint">점수는 일치하는 식별 정보의 정도입니다. 같은 사람인지 원본을 확인한 뒤 병합하거나, 서로 다른 사람이라면 별개 회원으로 승인하세요.</p>}
      <div className="connection-controls"><button className="quiet-button" disabled={state.busy} onClick={() => mutate({ action: "approve", domain: record.domain })}>{duplicateCandidates.length ? "별개 회원으로 승인" : "검토 완료 · 승인"}</button><button className="danger-button" disabled={state.busy} onClick={() => mutate({ action: "reject", domain: record.domain })}>집계에서 제외</button></div>
      {record.domain === "member" && <><label className="admin-field">병합 후 유지할 회원<select value={retainedId} disabled={state.busy} onChange={e => setRetained(e.target.value)}><option value="">승인된 회원 선택</option>{members.filter(m => m.id !== record.id).map(m => <option key={m.id} value={m.id}>{m.name ?? m.external_member_id ?? m.id} · {m.external_member_id ?? m.id.slice(0,8)}</option>)}</select></label><button className="danger-button" disabled={!retainedId || state.busy} onClick={() => setMerging(true)}>회원 병합 검토</button></>}
    </div>}{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
      {merging && <ConfirmationDialog title="회원 병합 확인" confirmLabel="병합 실행" busy={state.busy} onCancel={() => setMerging(false)} onConfirm={async () => { if (await mutate({ action: "merge", retainedId })) setMerging(false); }}><p>{String(record.name ?? record.id)} → {candidate?.name ?? retainedId}</p><p>등록·상담·수업을 유지할 회원으로 연결합니다. 원본 기록과 별칭은 보존되며 중복 회원은 집계에서 제외됩니다.</p>{state.error && <p role="alert">{state.error}</p>}</ConfirmationDialog>}
    </td></tr>;
}
