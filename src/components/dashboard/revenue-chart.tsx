"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Table2 } from "lucide-react";
import type { RevenuePoint } from "@/features/analytics/types";
import { number, won } from "./format";

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const reduced = useReducedMotion();
  const active = data.find((row) => row.month === selected) ?? data.at(-1);
  const plot = useRef<HTMLDivElement>(null);
  const activeTarget = useRef<HTMLButtonElement>(null);
  const sourceNames = [...new Set(data.flatMap((row) => Object.keys(row.sourceRevenue ?? {})))].sort((a, b) => a.localeCompare(b, "ko"));
  const sourceLabel = (row: RevenuePoint) => sourceNames.map((source) => `${source} ${won(row.sourceRevenue?.[source] ?? 0)}`).join(", ");
  const crossesYear =
    data[0]?.month.slice(0, 4) !== data.at(-1)?.month.slice(0, 4);
  useEffect(() => {
    const viewport = plot.current;
    const target = activeTarget.current;
    if (!viewport || !target) return;
    const left = target.offsetLeft;
    const right = left + target.offsetWidth;
    // Keep selection visible without scrolling the page or animating motion.
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (right > viewport.scrollLeft + viewport.clientWidth)
      viewport.scrollLeft = right - viewport.clientWidth;
  }, [active?.month, data.length]);
  const maximum = Math.max(
    1,
    ...data.flatMap((row) => [row.newRevenue, row.renewedRevenue]),
  );
  const total = data.reduce(
    (sum, row) =>
      sum + row.newRevenue + row.renewedRevenue + row.additionalRevenue + (row.fieldRevenue ?? 0) + (row.otRevenue ?? 0) + (row.uncategorizedRevenue ?? 0),
    0,
  );
  return (
    <div className="revenue-story">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PT TEAM REVENUE</p>
          <h2>PT 팀 매출 유형별 흐름</h2>
        </div>
        <ArrowUpRight size={23} aria-hidden="true" />
      </div>
      <div className="revenue-context">
        <strong className="metric-type">
          {number(total)}
          <small> 원</small>
        </strong>
        <div className="chart-legend">
          <span>
            <i />
            신규
          </span>
          <span>
            <i className="renewed" />
            재등록
          </span>
        </div>
      </div>
      <div className="chart-axis">
        <span>단위 원</span>
        <span>{won(maximum)}</span>
      </div>
      <div
        className="revenue-chart-scroll"
        ref={plot}
        role="region"
        tabIndex={0}
        aria-label="월별 매출 비교, 작은 화면에서 좌우 스크롤"
      >
        <div
          className="revenue-bars"
          style={{
            minWidth: `${data.length * 44 + Math.max(0, data.length - 1) * 8 + 8}px`,
          }}
        >
          {data.map((point, index) => (
            <button
              type="button"
              className={`bar-group${active?.month === point.month ? " selected" : ""}`}
              key={point.month}
              ref={active?.month === point.month ? activeTarget : undefined}
              aria-pressed={active?.month === point.month}
              aria-label={`${point.month.slice(0, 4)}년 ${Number(point.month.slice(5))}월 신규 ${won(point.newRevenue)}, 재등록 ${won(point.renewedRevenue)}, 유입경로 ${sourceLabel(point) || "미확인"}`}
              onClick={() => setSelected(point.month)}
              onFocus={() => setSelected(point.month)}
            >
              <span className="bar-pair" aria-hidden="true">
                {[point.newRevenue, point.renewedRevenue].map(
                  (value, series) => (
                    <motion.span
                      key={series}
                      className={`revenue-bar ${["new", "renewed"][series]}`}
                      initial={{ scaleY: 0 }}
                      animate={{
                        scaleY: 1,
                        height: `${(value / maximum) * 100}%`,
                      }}
                      transition={{
                        delay: reduced ? 0 : 0.22 + index * 0.025,
                        duration: reduced ? 0 : 0.32,
                        ease: "easeOut",
                      }}
                      style={{
                        originY: 1,
                        minHeight: value ? 3 : 0,
                        height: `${(value / maximum) * 100}%`,
                      }}
                    />
                  ),
                )}
              </span>
              <span className="month-label">
                {crossesYear
                  ? point.month.slice(2).replace("-", ".")
                  : `${Number(point.month.slice(5))}월`}
              </span>
            </button>
          ))}
        </div>
      </div>
      {data.length > 5 && (
        <p className="chart-scroll-hint">좌우로 밀어 월별 매출을 확인하세요.</p>
      )}
      <div className="chart-readout" role="status">
        {active ? (
          <>
            <strong>{active.month.replace("-", ".")}</strong>
            <span>신규 {won(active.newRevenue)}</span>
            <span>재등록 {won(active.renewedRevenue)}</span>
            {sourceNames.map((source) => <span key={source}>{source} {won(active.sourceRevenue?.[source] ?? 0)}</span>)}
          </>
        ) : (
          "선택 기간에 매출 기록이 없습니다."
        )}
      </div>
      <div className="chart-footer">
        <span>PT 매출 기준 · 신규·재등록과 원본 유입경로를 각각 분리</span>
        <button
          type="button"
          className="text-button"
          aria-expanded={table}
          onClick={() => setTable(!table)}
        >
          <Table2 size={14} aria-hidden="true" />
          {table ? "표 닫기" : "표로 보기"}
        </button>
      </div>
      {table && (
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table">
            <caption>기간별 PT 등록 매출</caption>
            <thead>
              <tr>
                <th scope="col">기간</th>
                <th scope="col">신규</th>
                <th scope="col">재등록</th>
                {sourceNames.map((source) => <th scope="col" key={source}>{source}</th>)}
                <th scope="col">추가</th>
                <th scope="col">미분류</th>
                <th scope="col">환불</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{row.month}</th>
                  <td>{won(row.newRevenue)}</td>
                  <td>{won(row.renewedRevenue)}</td>
                  {sourceNames.map((source) => <td key={source}>{won(row.sourceRevenue?.[source] ?? 0)}</td>)}
                  <td>{won(row.additionalRevenue)}</td>
                  <td>{won(row.uncategorizedRevenue ?? 0)}</td>
                  <td>{won(row.refunds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
