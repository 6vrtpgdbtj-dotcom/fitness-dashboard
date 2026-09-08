"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Table2 } from "lucide-react";
import type { RevenuePoint } from "@/features/analytics/types";
import { number, won } from "./format";

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const reduced = useReducedMotion();
  const active = data.find((row) => row.month === selected) ?? data.at(-1);
  const maximum = Math.max(
    1,
    ...data.flatMap((row) => [row.newRevenue, row.renewedRevenue]),
  );
  const total = data.reduce(
    (sum, row) =>
      sum + row.newRevenue + row.renewedRevenue + row.additionalRevenue,
    0,
  );
  return (
    <div className="revenue-story">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">REVENUE / 등록 매출</p>
          <h2>신규·재등록 매출의 흐름</h2>
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
        className={`revenue-bars${data.length > 8 ? " dense-bars" : ""}`}
        aria-label="신규 및 재등록 매출 비교"
      >
        {data.map((point, index) => (
          <button
            type="button"
            className={`bar-group${active?.month === point.month ? " selected" : ""}`}
            key={point.month}
            aria-pressed={active?.month === point.month}
            aria-label={`${Number(point.month.slice(5))}월 신규 ${won(point.newRevenue)}, 재등록 ${won(point.renewedRevenue)}`}
            onClick={() => setSelected(point.month)}
            onFocus={() => setSelected(point.month)}
          >
            <span className="bar-pair" aria-hidden="true">
              {[point.newRevenue, point.renewedRevenue].map((value, series) => (
                <motion.span
                  key={series}
                  className={`revenue-bar${series ? " renewed" : ""}`}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1, height: `${(value / maximum) * 100}%` }}
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
              ))}
            </span>
            <span className="month-label">
              {Number(point.month.slice(5))}월
            </span>
          </button>
        ))}
      </div>
      <div className="chart-readout" role="status">
        {active ? (
          <>
            <strong>{active.month.replace("-", ".")}</strong>
            <span>신규 {won(active.newRevenue)}</span>
            <span>재등록 {won(active.renewedRevenue)}</span>
          </>
        ) : (
          "선택 기간에 매출 기록이 없습니다."
        )}
      </div>
      <div className="chart-footer">
        <span>환불은 매출에서 분리 표시 · 추가/유형 미확인은 표에서 확인</span>
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
            <caption>기간별 등록 매출</caption>
            <thead>
              <tr>
                <th scope="col">기간</th>
                <th scope="col">신규</th>
                <th scope="col">재등록</th>
                <th scope="col">추가·미확인</th>
                <th scope="col">환불</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{row.month}</th>
                  <td>{won(row.newRevenue)}</td>
                  <td>{won(row.renewedRevenue)}</td>
                  <td>{won(row.additionalRevenue)}</td>
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
