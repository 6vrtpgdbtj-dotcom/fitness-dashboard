"use client";
import { CircleAlert, RefreshCw } from "lucide-react";

export function DashboardLoading() {
  return (
    <section
      className="dashboard-loading"
      aria-busy="true"
      role="status"
      aria-label="운영 데이터 불러오는 중"
    >
      <p className="eyebrow">LOADING DATA</p>
      <h2>운영 데이터를 불러오고 있습니다.</h2>
      <p className="muted">담당 범위의 유효한 기록을 확인합니다.</p>
      <div className="dashboard-flow" aria-hidden="true">
        <div className="metrics-strip skeleton-metrics">
          {[0, 1, 2, 3].map((item) => (
            <span className="metric-cell" key={item} />
          ))}
        </div>
        <div className="dashboard-revenue skeleton-chart" />
        <div className="dashboard-funnel skeleton-funnel" />
      </div>
    </section>
  );
}
export function DashboardError({ retry }: { retry?: () => void }) {
  return (
    <section className="dashboard-error" role="alert">
      <CircleAlert size={28} aria-hidden="true" />
      <div>
        <p className="eyebrow">DATA UNAVAILABLE</p>
        <h2>운영 데이터를 불러오지 못했습니다.</h2>
        <p>잠시 후 다시 시도하세요. 원본 시트와 저장된 기록은 유지됩니다.</p>
      </div>
      <button
        type="button"
        className="quiet-button"
        onClick={retry ?? (() => window.location.reload())}
      >
        <RefreshCw size={15} aria-hidden="true" />
        다시 불러오기
      </button>
    </section>
  );
}
