"use client";
import { motion, useReducedMotion } from "motion/react";
import type {
  DashboardData,
  SourceConversion,
} from "@/features/analytics/types";
import { number, percent } from "./format";

export function ConversionFunnel({
  data,
  sources,
}: {
  data: DashboardData["funnel"];
  sources: SourceConversion[];
}) {
  const reduced = useReducedMotion();
  const maximum = Math.max(1, data.leads, data.consulted, data.converted);
  return (
    <div className="funnel-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CONSULTATION</p>
          <h2>상담이 등록으로</h2>
        </div>
      </div>
      <div className="conversion-rate">
        <strong className="metric-type">
          {percent(
            data.consulted ? (data.converted / data.consulted) * 100 : null,
          )}
        </strong>
        <span>상담 → 등록 전환</span>
      </div>
      <ol className="funnel-steps">
        {[
          ["유입 리드", data.leads],
          ["상담 완료", data.consulted],
          ["등록 전환", data.converted],
        ].map(([label, count], index) => (
          <li key={label}>
            <div>
              <span>
                <small>0{index + 1}</small>
                {label}
              </span>
              <strong>
                {number(Number(count))}
                <small> 건</small>
              </strong>
            </div>
            <span className="funnel-track" aria-hidden="true">
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{
                  scaleX: 1,
                  width: `${(Number(count) / maximum) * 100}%`,
                }}
                transition={{
                  duration: reduced ? 0 : 0.32,
                  delay: reduced ? 0 : 0.22 + index * 0.08,
                }}
                style={{
                  originX: 0,
                  width: `${(Number(count) / maximum) * 100}%`,
                }}
              />
            </span>
          </li>
        ))}
      </ol>
      {!data.consulted && (
        <p className="muted">상담 완료 기록이 아직 없습니다.</p>
      )}
      <p className="funnel-note">
        상담일이 있는 유효한 완료 상담 기준. 유입은 문의일, 전환은 상담일
        기준으로 집계합니다.
      </p>
      {sources.length > 0 && (
        <div className="source-conversion">
          <h3>유입 경로별 전환</h3>
          {sources.map((source) => (
            <div key={source.source}>
              <span>
                {source.source}
                <small>
                  {source.converted} / {source.consulted}건
                </small>
              </span>
              <strong>{percent(source.conversionRate)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
