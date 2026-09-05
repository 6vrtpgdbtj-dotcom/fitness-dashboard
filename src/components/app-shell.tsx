import type { ReactNode } from "react";

export type AppRole = "admin" | "trainer";

const trainerNav = ["통합 현황", "회원 관리", "등록·매출", "상담 리드", "수업 현황"];
const adminNav = [...trainerNav, "시트 연결", "데이터 점검", "사용자 관리"];

type AppShellProps = {
  children: ReactNode;
  role: AppRole;
  displayName: string;
};

export function AppShell({ children, role, displayName }: AppShellProps) {
  const items = role === "admin" ? adminNav : trainerNav;

  return (
    <div className="app-shell">
      <aside className="desktop-rail">
        <a className="brand-type brand-mark" href="#main-content" aria-label="1986 FITNESS 홈">
          <span>86</span>
          <span>FITNESS</span>
        </a>
        <p className="branch-label">중산점 운영 현황</p>
        <nav aria-label="주 메뉴">
          {items.map((item, index) => (
            <a className={index === 0 ? "is-current" : undefined} key={item} href="#">
              {item}
            </a>
          ))}
        </nav>
        <div className="rail-status" aria-label="데이터 동기화 상태">
          <span className="status-dot" aria-hidden="true" />
          <span>시트 연결 준비됨</span>
        </div>
      </aside>
      <section className="shell-content">
        <header className="app-header">
          <div>
            <p className="eyebrow">1986 FITNESS · JUNG-SAN</p>
            <h1>운영 대시보드</h1>
          </div>
          <div className="user-context" aria-label="현재 사용자">
            <span className="avatar" aria-hidden="true">{displayName.slice(0, 1)}</span>
            <span>{displayName}</span>
          </div>
        </header>
        <main id="main-content">{children}</main>
      </section>
      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {trainerNav.map((item, index) => (
          <a className={index === 0 ? "is-current" : undefined} key={item} href="#">
            {item}
          </a>
        ))}
      </nav>
    </div>
  );
}
