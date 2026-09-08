import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/require-user";
import { getDashboardData } from "@/features/analytics/queries";
import { currentMonth, parsePeriod } from "@/features/analytics/aggregate";
import { DashboardView } from "./dashboard-view";
import { DashboardError } from "./dashboard-states";
import { DetailView, detailTitles, type DetailKind } from "./detail-view";
import { RealtimeRefresh } from "./realtime-refresh";
import { SyncPulse } from "./sync-pulse";

export type DashboardSearch = Promise<{ start?: string; end?: string }>;
export async function ServerDashboardPage({
  searchParams,
  kind,
}: {
  searchParams: DashboardSearch;
  kind?: DetailKind;
}) {
  const scope = await requireUser();
  const params = await searchParams;
  // Only date controls are read from the URL. The user scope always comes from requireUser.
  const requestedPeriod = parsePeriod(params.start, params.end);
  const invalidPeriod =
    (params.start !== undefined || params.end !== undefined) &&
    !requestedPeriod;
  const period = requestedPeriod ?? currentMonth();
  let data;
  try {
    data = await getDashboardData(scope, period);
  } catch {
    return (
      <AppShell
        role={scope.role}
        displayName={scope.role === "admin" ? "관리자" : "트레이너"}
      >
        <DashboardError />
      </AppShell>
    );
  }
  return (
    <AppShell
      role={scope.role}
      displayName={
        scope.role === "admin"
          ? "관리자"
          : (data.rows.trainers[0]?.display_name ?? "트레이너")
      }
      title={
        kind
          ? detailTitles[kind]
          : scope.role === "admin"
            ? "중산점 운영 현황"
            : "나의 운영 현황"
      }
      railContent={
        scope.role === "admin" ? (
          <SyncPulse connections={data.connections} />
        ) : undefined
      }
    >
      {data.realtimeTopic && <RealtimeRefresh topic={data.realtimeTopic} />}
      {invalidPeriod && (
        <p role="alert" className="form-error filter-error">
          날짜 범위를 확인하세요. 시작일 이후의 종료일, 최대 1년을 선택할 수
          있습니다. 현재는 이번 달을 표시합니다.
        </p>
      )}
      {kind ? (
        <>
          <form className="detail-period">
            <label>
              시작일
              <input
                name="start"
                type="date"
                defaultValue={period.start}
                required
              />
            </label>
            <label>
              종료일
              <input
                name="end"
                type="date"
                defaultValue={period.end}
                required
              />
            </label>
            <button className="quiet-button" type="submit">
              기간 적용
            </button>
          </form>
          <DetailView kind={kind} data={data} />
        </>
      ) : (
        <DashboardView data={data} scope={scope} />
      )}
    </AppShell>
  );
}
