import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  DashboardError,
  DashboardLoading,
} from "@/components/dashboard/dashboard-states";
import {
  DetailView,
  detailTitles,
  type DetailKind,
} from "@/components/dashboard/detail-view";
import { SyncPulse } from "@/components/dashboard/sync-pulse";
import { buildDashboardData } from "@/features/analytics/aggregate";
import { sampleRows } from "@/features/analytics/sample-data";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    state?: string;
    view?: string;
    balance?: string;
  }>;
}) {
  const params = await searchParams;
  const role = params.role === "trainer" ? "trainer" : "admin";
  const balance =
    params.balance === "unknown" ||
    params.balance === "partial" ||
    params.balance === "renewed"
      ? params.balance
      : undefined;
  const state = ["empty", "partial", "loading", "error"].includes(
    params.state ?? "",
  )
    ? params.state
    : "normal";
  const kind = ["members", "registrations", "leads", "classes"].includes(
    params.view ?? "",
  )
    ? (params.view as DetailKind)
    : undefined;
  const scope = {
    id: "sample-viewer",
    role,
    trainerId: role === "trainer" ? "sample-a" : null,
  } as const;
  const rows =
    state === "empty"
      ? {
          members: [],
          registrations: [],
          leads: [],
          classes: [],
          trainers: [],
          connections: [],
        }
      : sampleRows(balance);
  if (state === "partial")
    rows.connections[1] = { ...rows.connections[1], status: "failed" };
  const data = buildDashboardData(
    rows,
    scope,
    { start: "2026-04-01", end: "2026-09-30" },
    "2026-09-08",
  );
  return (
    <AppShell
      role={role}
      displayName={role === "admin" ? "샘플 관리자" : "샘플 트레이너 A"}
      title={
        kind
          ? detailTitles[kind]
          : role === "admin"
            ? "중산점 운영 현황"
            : "나의 운영 현황"
      }
      sample
      railContent={
        role === "admin" ? (
          <SyncPulse connections={rows.connections} />
        ) : undefined
      }
    >
      <div className="sample-banner">
        <strong>샘플 화면</strong>
        <span>
          모든 이름·수치는 가상 예시입니다. 실제 데이터와 연결되지 않습니다.
        </span>
        <a href="/login">실제 운영 로그인 ↗</a>
      </div>
      {balance && (
        <p className="sample-banner">
          <strong>잔여 세션 검증 예시</strong>
          <span>
            {balance === "unknown"
              ? "모든 회원의 현재 잔여 세션이 미확인인 가상 사례입니다."
              : balance === "partial"
                ? "한 회원의 11회만 확인되고 나머지는 미확인인 가상 사례입니다."
                : "샘플 회원 01: 어제 수업 후 1회, 오늘 10회 재등록 후 현재 11회인 가상 사례입니다."}
          </span>
        </p>
      )}
      <div className="sample-controls" aria-label="샘플 상태 선택">
        <div>
          {[
            ["admin", "관리자"],
            ["trainer", "트레이너"],
          ].map(([value, label]) => (
            <a
              key={value}
              href={`/demo?role=${value}&state=${state}`}
              aria-current={role === value ? "true" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
        <div>
          {[
            ["normal", "정상"],
            ["empty", "첫 연결"],
            ["partial", "일부 실패"],
            ["loading", "불러오는 중"],
            ["error", "오류"],
          ].map(([value, label]) => (
            <a
              key={value}
              href={`/demo?role=${role}&state=${value}`}
              aria-current={state === value ? "true" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
      {state === "loading" ? (
        <DashboardLoading />
      ) : state === "error" ? (
        <DashboardError />
      ) : kind ? (
        <DetailView kind={kind} data={data} />
      ) : (
        <DashboardView data={data} scope={scope} />
      )}
    </AppShell>
  );
}
