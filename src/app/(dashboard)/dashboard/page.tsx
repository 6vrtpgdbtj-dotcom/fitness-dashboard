import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/require-user";

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <AppShell role={user.role} displayName={user.role === "admin" ? "관리자" : "트레이너"}>
      <section className="foundation-intro" aria-labelledby="dashboard-title">
        <p className="eyebrow">1986 FITNESS</p>
        <h2 id="dashboard-title">운영 현황을 준비하고 있습니다.</h2>
        <p>시트 연결과 첫 동기화가 완료되면 담당 범위의 회원·등록·상담·수업 현황이 표시됩니다.</p>
      </section>
    </AppShell>
  );
}
