"use client";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, SlidersHorizontal } from "lucide-react";
import type { UserScope } from "@/lib/auth/user-scope";
import type { DashboardData } from "@/features/analytics/types";
import {
  buildDashboardData,
  parsePeriod,
} from "@/features/analytics/aggregate";
import { DashboardMotion, MotionSection } from "./dashboard-motion";
import { MetricCard } from "./metric-card";
import { RevenueChart } from "./revenue-chart";
import { ConversionFunnel } from "./conversion-funnel";
import { RenewalTable } from "./renewal-table";
import { SyncPulse } from "./sync-pulse";
import { TodayClasses } from "./today-classes";
import { number, percent, won } from "./format";

export function DashboardView({
  data: initial,
  scope,
}: {
  data: DashboardData;
  scope: UserScope;
}) {
  const [period, setPeriod] = useState(initial.period);
  const [draft, setDraft] = useState(initial.period);
  const [trainer, setTrainer] = useState("");
  const [error, setError] = useState("");
  const data = useMemo(() => {
    const rows = initial.rows;
    const selected =
      scope.role === "admin" &&
      rows.trainers.some((item) => item.id === trainer)
        ? trainer
        : "";
    const filtered = selected
      ? {
          ...rows,
          members: rows.members.filter((row) => row.trainer_id === selected),
          registrations: rows.registrations.filter(
            (row) => row.trainer_id === selected,
          ),
          leads: rows.leads.filter((row) => row.trainer_id === selected),
          classes: rows.classes.filter((row) => row.trainer_id === selected),
          trainers: rows.trainers.filter((row) => row.id === selected),
        }
      : rows;
    return buildDashboardData(filtered, scope, period, initial.today);
  }, [initial, scope, period, trainer]);
  const applyPeriod = (event: FormEvent) => {
    event.preventDefault();
    const valid = parsePeriod(draft.start, draft.end);
    if (!valid) {
      setError(
        "날짜를 확인하세요. 시작일 이후의 종료일, 최대 1년을 선택할 수 있습니다.",
      );
      return;
    }
    setError("");
    setPeriod(valid);
  };
  const hasData =
    initial.rows.members.length +
      initial.rows.registrations.length +
      initial.rows.leads.length +
      initial.rows.classes.length >
    0;
  const metrics = data.metrics;
  const remaining = metrics.remainingSessions;
  const remainingDetail =
    remaining.total !== null
      ? `잔여 세션 합계 ${number(remaining.total)}회`
      : remaining.knownMembers
        ? `확인된 잔여 ${number(remaining.knownSubtotal)}회 · ${number(remaining.unknownMembers)}명 미확인`
        : `잔여 세션 미확인 · ${number(remaining.unknownMembers)}명 기록 필요`;
  return (
    <>
      <div className="dashboard-toolbar">
        <p>
          <span className="toolbar-line" />
          {scope.role === "admin"
            ? "데이터를 확인하고, 다음 운영을 결정하세요."
            : "담당 회원과 오늘의 수업부터 확인하세요."}
        </p>
        <span className="scope-label">
          {scope.role === "admin" ? "BRANCH OVERVIEW" : "MY WORKSPACE"}
        </span>
      </div>
      <form className="dashboard-filters" onSubmit={applyPeriod}>
        <div className="filter-title">
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>조회 범위</span>
        </div>
        <div className="date-fields">
          <label>
            시작일
            <input
              type="date"
              value={draft.start}
              onChange={(event) =>
                setDraft({ ...draft, start: event.target.value })
              }
              required
              aria-describedby={error ? "period-error" : undefined}
            />
          </label>
          <span aria-hidden="true">—</span>
          <label>
            종료일
            <input
              type="date"
              value={draft.end}
              onChange={(event) =>
                setDraft({ ...draft, end: event.target.value })
              }
              required
              aria-describedby={error ? "period-error" : undefined}
            />
          </label>
          <button type="submit" className="quiet-button">
            <CalendarDays size={14} aria-hidden="true" />
            기간 적용
          </button>
        </div>
        {scope.role === "admin" && (
          <label className="trainer-filter">
            담당 트레이너
            <select
              value={trainer}
              onChange={(event) => setTrainer(event.target.value)}
            >
              <option value="">전체 트레이너</option>
              {initial.rows.trainers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>
      {error && (
        <p id="period-error" className="form-error filter-error" role="alert">
          {error}
        </p>
      )}
      {!hasData && (
        <section className="dashboard-empty">
          <div>
            <p className="eyebrow">START WITH YOUR DATA</p>
            <h2>
              {scope.role === "admin"
                ? "첫 시트가 연결되면, 운영이 한눈에."
                : "담당 데이터의 첫 동기화를 기다립니다."}
            </h2>
            <p>
              {scope.role === "admin"
                ? "운영 시트를 읽기 전용으로 연결하세요. 유효한 회원·결제·상담·수업 기록부터 현황에 반영됩니다."
                : "관리자가 시트를 연결하고 담당자를 지정하면 나의 회원과 수업이 여기에 표시됩니다."}
            </p>
          </div>
          {scope.role === "admin" && (
            <a className="primary-action" href="/settings/sheets">
              Google 시트 연결 <ArrowRight size={16} aria-hidden="true" />
            </a>
          )}
        </section>
      )}
      <DashboardMotion role={scope.role}>
        <MotionSection className="metrics-strip">
          <MetricCard
            label="선택 기간 PT 매출"
            value={number(metrics.periodRevenue)}
            unit="원"
            detail={`전체 누적 ${won(metrics.totalRevenue)} · 환불 ${won(metrics.refunds)} 별도`}
            accent
          />
          <MetricCard
            label="선택 기간 FC 매출"
            value={number(metrics.fcRevenue)}
            unit="원"
            detail="회원권·락커·운동복 등 FC 결제"
            index={1}
          />
          <MetricCard
            label="등록 현황"
            value={number(metrics.newRegistrations)}
            unit="건 신규"
            detail={`재등록 ${number(metrics.renewedRegistrations)}건 · 결제 완료 기준`}
            index={1}
          />
          <MetricCard
            label={scope.role === "admin" ? "상담 등록 전환율" : "담당 회원"}
            value={
              scope.role === "admin"
                ? percent(metrics.conversionRate)
                : number(metrics.assignedMembers)
            }
            unit={scope.role === "trainer" ? "명" : undefined}
            detail={
              scope.role === "admin"
                ? `완료 상담 ${data.funnel.consulted}건 중 ${data.funnel.converted}건 등록`
                : remainingDetail
            }
            index={2}
          />
          <MetricCard
            label="진행 수업"
            value={number(metrics.completedClasses)}
            unit="회"
            detail={`오늘 예정 ${data.todayClasses.filter((row) => row.status === "scheduled").length}회 · 완료 수업 기준`}
            index={3}
          />
        </MotionSection>
        {scope.role === "admin" && (
          <div className="mobile-sync">
            <SyncPulse connections={data.connections} />
          </div>
        )}
        <MotionSection className="dashboard-today">
          <TodayClasses
            classes={data.todayClasses}
            members={data.members}
            today={data.today}
          />
        </MotionSection>
        <MotionSection className="dashboard-revenue">
          <RevenueChart data={data.revenue} />
        </MotionSection>
        <MotionSection className="dashboard-funnel">
          <ConversionFunnel data={data.funnel} sources={data.sources} />
        </MotionSection>
        <MotionSection className="dashboard-renewals">
          <RenewalTable members={data.renewals} role={scope.role} />
        </MotionSection>
        {scope.role === "admin" && (
          <MotionSection className="trainer-comparison">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TEAM PERFORMANCE</p>
                <h2>트레이너별 운영 비교</h2>
              </div>
              <span className="panel-note">선택 기간 기준</span>
            </div>
            {data.trainerComparison.length ? (
              <div className="table-scroll" tabIndex={0}>
                <table className="data-table">
                  <caption className="sr-only">
                    트레이너별 매출 및 운영 비교
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">트레이너</th>
                      <th scope="col">결제 매출</th>
                      <th scope="col">신규 / 재등록</th>
                      <th scope="col">진행 수업</th>
                      <th scope="col">담당 회원</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trainerComparison.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.name}</th>
                        <td className="comparison-revenue">
                          <span
                            style={{
                              width: `${(row.revenue / Math.max(1, ...data.trainerComparison.map((item) => item.revenue))) * 100}%`,
                            }}
                            aria-hidden="true"
                          />
                          <strong>{won(row.revenue)}</strong>
                        </td>
                        <td>
                          {row.newRegistrations} / {row.renewedRegistrations}건
                        </td>
                        <td>{row.classes}회</td>
                        <td>{row.members}명</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-inline">등록된 트레이너가 없습니다.</p>
            )}
          </MotionSection>
        )}
        <div className="summary-footnote">
          <span>
            평균 결제{" "}
            {metrics.averagePayment === null
              ? "기록 없음"
              : won(metrics.averagePayment)}
          </span>
          <span>
            평균 등록{" "}
            {metrics.averageSessions === null
              ? "기록 없음"
              : `${number(metrics.averageSessions)}회`}
          </span>
          <span>검토 필요·미결제 기록은 지표에서 제외</span>
        </div>
      </DashboardMotion>
    </>
  );
}
