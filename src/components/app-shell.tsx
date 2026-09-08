"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  MessagesSquare,
  Dumbbell,
  Database,
  ScanLine,
  UserCog,
  ArrowUpRight,
} from "lucide-react";

export type AppRole = "admin" | "trainer";

const trainerNav = [
  {
    label: "통합 현황",
    short: "현황",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  { label: "회원 관리", short: "회원", href: "/members", icon: Users },
  {
    label: "등록·매출",
    short: "등록",
    href: "/registrations",
    icon: CreditCard,
  },
  { label: "상담 리드", short: "상담", href: "/leads", icon: MessagesSquare },
  { label: "수업 현황", short: "수업", href: "/classes", icon: Dumbbell },
];

type AppShellProps = {
  children: ReactNode;
  role: AppRole;
  displayName: string;
  railContent?: ReactNode;
  title?: string;
  sample?: boolean;
};

export function AppShell({
  children,
  role,
  displayName,
  railContent,
  title = "중산점 운영 현황",
  sample = false,
}: AppShellProps) {
  const pathname = usePathname();
  const href = (path: string) =>
    sample ? `/demo?view=${path.slice(1)}&role=${role}` : path;

  return (
    <div className="app-shell">
      <aside className="desktop-rail">
        <a
          className="brand-type brand-mark"
          href={href("/dashboard")}
          aria-label="1986 FITNESS 홈"
        >
          <span>86</span>
          <span>FITNESS</span>
        </a>
        <p className="branch-label">중산점 운영 현황</p>
        <nav aria-label="주 메뉴">
          {trainerNav.map((item, index) => (
            <a
              className={
                pathname === item.href || (sample && index === 0)
                  ? "is-current"
                  : undefined
              }
              aria-current={pathname === item.href ? "page" : undefined}
              key={item.href}
              href={href(item.href)}
            >
              <item.icon size={17} aria-hidden="true" />
              {item.label}
            </a>
          ))}
          {role === "admin" && (
            <>
              <p className="nav-divider">운영 설정</p>
              <a
                href="/settings/sheets"
                className={
                  pathname === "/settings/sheets" ? "is-current" : undefined
                }
              >
                <Database size={17} aria-hidden="true" />
                시트 연결
              </a>
              <span className="nav-disabled" aria-disabled="true">
                <ScanLine size={17} aria-hidden="true" />
                데이터 점검
              </span>
              <span className="nav-disabled" aria-disabled="true">
                <UserCog size={17} aria-hidden="true" />
                사용자 관리
              </span>
            </>
          )}
        </nav>
        <div className="rail-bottom">
          {railContent ?? (
            <p className="rail-note">
              {role === "trainer"
                ? "담당 회원·수업만 표시합니다."
                : "읽기 전용 시트 기반 운영"}
            </p>
          )}
          <div className="rail-edition">
            <span>JUNG-SAN</span>
            <span>OPS / 01</span>
          </div>
        </div>
      </aside>
      <section className="shell-content">
        <header className="app-header">
          <div>
            <p className="eyebrow">1986 FITNESS · JUNG-SAN</p>
            <h1>{title}</h1>
          </div>
          <div className="user-context" aria-label="현재 사용자">
            <span className="avatar" aria-hidden="true">
              {displayName.slice(0, 1)}
            </span>
            <span>{displayName}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </div>
        </header>
        <main id="main-content">{children}</main>
      </section>
      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {trainerNav.map((item, index) => (
          <a
            className={
              pathname === item.href || (sample && index === 0)
                ? "is-current"
                : undefined
            }
            aria-current={pathname === item.href ? "page" : undefined}
            key={item.href}
            href={href(item.href)}
          >
            <item.icon size={19} aria-hidden="true" />
            {item.short}
          </a>
        ))}
      </nav>
    </div>
  );
}
