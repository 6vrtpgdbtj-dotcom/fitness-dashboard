import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AppShell role="admin" displayName="관리자">
      <section className="foundation-intro" aria-labelledby="welcome-title">
        <p className="eyebrow">TODAY&apos;S OPERATIONS</p>
        <h2 id="welcome-title">중산점의 현재 상태를 연결하세요.</h2>
        <p>
          Google 시트를 연결하면 등록, 상담, 수업 데이터를 한 화면에서 신뢰할 수 있는 운영 흐름으로 확인할 수 있습니다.
        </p>
        <a className="primary-action" href="#">Google 시트 연결</a>
      </section>
    </AppShell>
  );
}
