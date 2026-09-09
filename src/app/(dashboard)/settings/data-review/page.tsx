import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { AppShell } from "@/components/app-shell";
import { readAdminWorkspace } from "@/features/admin/read-workspace";
import { RecordReviewTable } from "@/components/review/record-review-table";
import { MappingWorkspace } from "@/components/review/mapping-workspace";
import { AuditTable } from "@/components/review/audit-table";
import { ConnectionControls } from "@/components/review/connection-controls";
import "@/components/review/admin.css";
export default async function DataReviewPage() {
  if ((await requireUser()).role !== "admin") redirect("/dashboard");
  const data = await readAdminWorkspace();
  return <AppShell role="admin" displayName="관리자" title="데이터 점검"><div className="admin-stack">
    <div className="admin-intro"><p className="eyebrow">DATA QUALITY / CONTROL</p><h2>원본에서 운영 데이터까지.</h2><p>매핑과 검토 대상, 변경 이력을 한곳에서 확인하세요.</p></div>
    <RecordReviewTable records={data.records} members={data.members} /><MappingWorkspace tabs={data.tabs} />
    <section className="admin-section"><h2>연결과 원본 이력</h2><p className="form-hint">연결 해제 후에만 원본 스냅샷을 삭제할 수 있습니다.</p>{data.connections.map(c => <div className="admin-connection" key={c.id}><div><strong>{c.display_name}</strong><small>{c.is_active ? "연결 중" : "연결 해제됨"}</small></div><ConnectionControls connection={c} /></div>)}{!data.connections.length && <p className="admin-empty">연결된 시트가 없습니다.</p>}</section>
    <AuditTable events={data.audits} />
  </div></AppShell>;
}
