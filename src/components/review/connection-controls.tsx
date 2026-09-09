"use client";
import { useState } from "react";
import type { AdminConnection } from "@/features/admin/types";
import { useAdminMutation } from "./use-admin-mutation";
import { ConfirmationDialog } from "./confirmation-dialog";
export function ConnectionControls({ connection }: { connection: Pick<AdminConnection,"id" | "display_name" | "is_active"> }) {
  const state = useAdminMutation();
  const [confirm, setConfirm] = useState<"disconnect" | "delete_history" | null>(null);
  return <div><div className="connection-controls">
    {connection.is_active ? <button className="danger-button" disabled={state.busy} onClick={() => setConfirm("disconnect")}>연결 해제</button> : <button className="danger-button" disabled={state.busy} onClick={() => setConfirm("delete_history")}>원본 이력 삭제</button>}
  </div>{state.error && <p role="alert" className="form-error">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    {confirm && <ConfirmationDialog title={`${connection.display_name} · ${confirm === "disconnect" ? "연결 해제" : "원본 이력 삭제"}`} confirmLabel={confirm === "disconnect" ? "연결 해제 확인" : "영구 삭제"} phrase={confirm === "delete_history" ? "DELETE HISTORY" : undefined} busy={state.busy} onCancel={() => setConfirm(null)} onConfirm={async () => { if (await state.mutate(`/api/review/${connection.id}`, confirm === "disconnect" ? { action: confirm } : { action: confirm, confirmation: "DELETE HISTORY" })) setConfirm(null); }}>
      <p>{confirm === "disconnect" ? "앞으로 이 시트의 동기화를 중지합니다. 기존 운영 기록과 감사 이력은 보존됩니다." : "저장된 원본 스냅샷을 영구 삭제합니다. 복구할 수 없습니다. 회원·매출·수업, 매핑 버전과 감사 이력은 보존됩니다. 계속하려면 DELETE HISTORY를 입력하세요."}</p>{state.error && <p role="alert" className="form-error">{state.error}</p>}
    </ConfirmationDialog>}
  </div>;
}
