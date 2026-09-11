import type { DashboardData } from "@/features/analytics/types";
import { number, won } from "./format";

export function PtRevenueLedger({ data }: { data: DashboardData }) {
  const assigned = data.trainerComparison.reduce((sum, row) => sum + row.revenue, 0);
  const newRevenue = data.trainerComparison.reduce((sum, row) => sum + row.newRevenue, 0);
  const renewedRevenue = data.trainerComparison.reduce((sum, row) => sum + row.renewedRevenue, 0);
  const unassigned = Math.max(0, data.metrics.periodRevenue - assigned);
  const sources = [...new Set(data.trainerComparison.flatMap((row) => Object.keys(row.sourceRevenue ?? {})))].sort((a, b) => a.localeCompare(b, "ko"));
  const maxTrainerRevenue = Math.max(1, ...data.trainerComparison.map((row) => row.revenue));

  return (
    <section className="pt-ledger" role="group" aria-label="선택 기간 PT 매출">
      <header className="pt-ledger-head">
        <div>
          <p className="eyebrow">PT REVENUE LEDGER</p>
          <h2>PT 팀 매출</h2>
          <p className="pt-ledger-period">{data.period.start} — {data.period.end}</p>
        </div>
        <p className="pt-ledger-total"><strong>{number(data.metrics.periodRevenue)}</strong><span>원</span></p>
      </header>
      <div className="pt-ledger-splits" aria-label="신규 및 재등록 매출 구성">
        <div><span>신규 매출</span><strong>{won(newRevenue)}</strong></div>
        <div><span>재등록 매출</span><strong>{won(renewedRevenue)}</strong></div>
        <div><span>개인 연결 합계</span><strong>{won(assigned)}</strong></div>
        <div className="pt-ledger-unassigned"><span>팀 합계 보존</span><strong>미배정·기타 {won(unassigned)}</strong></div>
      </div>
      {sources.length > 0 && (
        <div className="pt-ledger-sources" aria-label="시트 유입 분류별 매출">
          {sources.map((source) => (
            <span key={source}><small>{source} 매출</small><strong>{won(data.trainerComparison.reduce((sum, row) => sum + (row.sourceRevenue?.[source] ?? 0), 0))}</strong></span>
          ))}
        </div>
      )}
      <ol className="pt-ledger-trainers" aria-label="트레이너별 PT 매출">
        {data.trainerComparison.map((row) => (
          <li key={row.id}>
            <span className="pt-ledger-trainer-name">{row.name}</span>
            <span className="pt-ledger-bar" aria-hidden="true"><i style={{ width: `${(row.revenue / maxTrainerRevenue) * 100}%` }} /></span>
            <strong>{won(row.revenue)}</strong>
            <small>신규 {won(row.newRevenue)} · 재등록 {won(row.renewedRevenue)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
