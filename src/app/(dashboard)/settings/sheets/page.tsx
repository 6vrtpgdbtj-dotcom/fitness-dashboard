import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AddSheetDialog } from "@/components/sheets/add-sheet-dialog";
import { requireUser } from "@/lib/auth/require-user";
import { listSheetConnections } from "@/lib/google/sheets";
import { createClient } from "@/lib/supabase/server";

export default async function SheetsSettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");

  const [connections, trainers] = await Promise.all([
    listSheetConnections(),
    (await createClient()).from("trainers").select("id, display_name").eq("is_active", true).order("display_name"),
  ]);

  return (
    <AppShell role="admin" displayName="관리자">
      <section className="sheets-page" aria-labelledby="sheets-title">
        <div className="sheets-hero">
          <div>
            <p className="eyebrow">SOURCE CONNECTIONS</p>
            <h2 id="sheets-title">Google 시트 연결</h2>
            <p>관리자만 원본 시트를 읽기 전용으로 연결할 수 있습니다. 트레이너는 Google 권한을 부여하지 않습니다.</p>
          </div>
          <div className="sheets-actions">
            <a className="quiet-button" href="/api/google/connect">Google 권한 연결</a>
            <AddSheetDialog trainers={(trainers.data ?? []).map((trainer) => ({ id: trainer.id, displayName: trainer.display_name }))} />
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="empty-connections">
            <p className="eyebrow">NO SOURCES YET</p>
            <h3>첫 번째 운영 시트를 연결하세요.</h3>
            <p>먼저 Google 권한을 연결한 뒤, 공유받은 Google Sheets URL을 추가하면 초기 동기화가 대기열에 등록됩니다.</p>
          </div>
        ) : (
          <div className="connection-list">
            {connections.map((connection) => (
              <article className="connection-row" key={connection.id}>
                <div>
                  <p className="eyebrow">{connection.status}</p>
                  <h3>{connection.display_name}</h3>
                  <p>담당: {connection.trainers?.[0]?.display_name ?? "공용 운영"} · 탭: {connection.sheet_tabs.map((tab) => tab.title).join(", ") || "탭 정보 대기"}</p>
                </div>
                <div className="connection-meta">
                  <span>최근 성공: {connection.last_successful_sync_at ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.last_successful_sync_at)) : "아직 없음"}</span>
                  <div className="connection-controls" aria-label={`${connection.display_name} 관리`}>
                    <button className="quiet-button" type="button" disabled>지금 동기화</button>
                    <button className="quiet-button" type="button" disabled>담당 변경</button>
                    <button className="danger-button" type="button" disabled>연결 해제</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
