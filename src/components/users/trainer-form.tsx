"use client";
import { useState } from "react";
import type { AdminConnection, Trainer } from "@/features/admin/types";
import { useAdminMutation } from "@/components/review/use-admin-mutation";
export function TrainerForm({ trainers, connections }: { trainers: Trainer[]; connections: AdminConnection[] }) {
  const state = useAdminMutation();
  return <div className="admin-stack"><section className="admin-section"><p className="eyebrow">TEAM ACCESS</p><h2>트레이너 초대</h2><p className="form-hint">Google 계정 이메일을 승인 목록에 등록합니다. 해당 이메일로 처음 로그인하면 담당 트레이너 권한이 연결됩니다. 초대 메일은 발송하지 않습니다.</p>
    <form className="admin-inline-form" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); if (await state.mutate("/api/trainers", { action: "invite", email: data.get("email"), displayName: data.get("displayName"), active: data.get("active") === "on" })) form.reset(); }}>
      <label className="admin-field">Google 이메일<input name="email" type="email" required maxLength={254} disabled={state.busy} /></label><label className="admin-field">표시 이름<input name="displayName" required maxLength={100} disabled={state.busy} /></label><label className="admin-check"><input name="active" type="checkbox" defaultChecked disabled={state.busy} />활성 계정</label><button className="primary-action" disabled={state.busy}>초대 등록</button>
    </form>{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
  </section><section className="admin-section"><h2>트레이너 목록</h2>{trainers.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">로그인 / 상태</th><th scope="col">관리</th></tr></thead><tbody>{trainers.map(t => <tr key={t.id}><th scope="row">{t.display_name}</th><td>{t.email}</td><td>{t.claimed ? "계정 연결" : "초대 대기"} · {t.is_active ? "활성" : "비활성"}</td><td><button className="quiet-button" disabled={state.busy} onClick={() => state.mutate("/api/trainers", { action: "activate", trainerId: t.id, active: !t.is_active })}>{t.display_name} {t.is_active ? "비활성화" : "활성화"}</button></td></tr>)}</tbody></table></div> : <p className="admin-empty">등록된 트레이너가 없습니다.</p>}</section>
    <section className="admin-section"><h2>시트별 담당자</h2><p className="form-hint">직접 지정하거나 매핑된 담당트레이너 열로 배정합니다. 열 방식은 활성 트레이너의 이름 또는 이메일이 정확히 한 명과 일치해야 합니다. 일치하지 않는 기록은 관리자 점검 대상으로 남습니다.</p>{connections.map(c => <Assignment key={`${c.id}:${c.trainer_id}:${c.trainer_assignment_mode}`} connection={c} trainers={trainers} />)}{!connections.length && <p className="admin-empty">연결된 시트가 없습니다.</p>}</section>
  </div>;
}
function Assignment({ connection, trainers }: { connection: AdminConnection; trainers: Trainer[] }) {
  const [mode,setMode] = useState(connection.trainer_assignment_mode), [trainerId,setTrainer] = useState(connection.trainer_id ?? "");
  const state = useAdminMutation();
  return <form className="admin-inline-form admin-assignment" onSubmit={e => { e.preventDefault(); state.mutate("/api/trainers", { action: "assign", connectionId: connection.id, mode, ...(mode === "direct" ? { trainerId } : {}) }); }}>
    <strong>{connection.display_name}</strong><label className="admin-field">배정 방식<select value={mode} disabled={state.busy} onChange={e => setMode(e.target.value as typeof mode)}><option value="direct">트레이너 직접 지정</option><option value="column">담당트레이너 열로 배정</option></select></label>
    {mode === "direct" && <label className="admin-field">담당 트레이너<select value={trainerId} required disabled={state.busy} onChange={e => setTrainer(e.target.value)}><option value="">선택</option>{trainers.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select></label>}<button className="quiet-button" disabled={state.busy || (mode === "direct" && !trainerId)}>담당 저장</button>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
  </form>;
}
