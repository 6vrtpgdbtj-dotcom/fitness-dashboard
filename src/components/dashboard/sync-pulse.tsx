"use client";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, CircleAlert, Database } from "lucide-react";
import type { ConnectionHealth } from "@/features/analytics/types";

export function SyncPulse({
  connections,
}: {
  connections: ConnectionHealth[];
}) {
  const reduced = useReducedMotion();
  const failed = connections.filter((row) =>
    ["failed", "retrying"].includes(row.status),
  );
  const pending = connections.some((row) =>
    ["running", "pending"].includes(row.status),
  );
  const latest = connections
    .map((row) => row.last_successful_sync_at)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  const title = !connections.length
    ? "첫 연결을 기다립니다"
    : failed.length
      ? "일부 연결 확인 필요"
      : pending
        ? "동기화 진행 중"
        : "데이터 연결 정상";
  return (
    <section
      className={`sync-pulse${failed.length ? " has-error" : ""}`}
      aria-label="연결 상태"
    >
      <div className="sync-top">
        <span className="eyebrow">SYNC PULSE</span>
        <Database size={16} aria-hidden="true" />
      </div>
      <div className="sync-title">
        <motion.span
          className={`pulse-dot${failed.length ? " warning" : !latest ? " idle" : ""}`}
          aria-hidden="true"
          key={latest}
          initial={{ scale: 1 }}
          animate={{ scale: reduced || !latest ? 1 : [1, 1.5, 1] }}
          transition={{ duration: reduced ? 0 : 0.42 }}
        />
        <strong>{title}</strong>
      </div>
      <p className="sync-count">
        <span className="metric-type">{connections.length}</span>개의 시트 연결
      </p>
      <p className="sync-time">
        최근 성공{" "}
        <strong>
          {latest
            ? new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(latest))
            : "아직 없음"}
        </strong>
      </p>
      <div className="sync-line" aria-hidden="true">
        {connections.map((row) => (
          <span
            key={row.id}
            className={row.status === "succeeded" ? "healthy" : "attention"}
          />
        ))}
      </div>
      {failed.length > 0 && (
        <>
          <ul className="sync-issues">
            {failed.map((row) => (
              <li key={row.id}>
                <CircleAlert size={13} aria-hidden="true" />
                <span>{row.display_name}</span>
                <small>
                  {row.status === "retrying" ? "재시도 대기" : "확인 필요"}
                </small>
              </li>
            ))}
          </ul>
          <p className="sync-note">성공 데이터는 계속 표시됩니다.</p>
        </>
      )}
      {connections.length > 0 && !failed.length && (
        <p className="sync-note">
          <Check size={12} aria-hidden="true" /> 원본 시트 읽기 전용
        </p>
      )}
      <a className="sync-link" href="/settings/sheets">
        {connections.length ? "시트 연결 확인" : "Google 시트 연결"}
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
