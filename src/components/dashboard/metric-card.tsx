"use client";
import { motion, useReducedMotion } from "motion/react";

export function MetricCard({
  label,
  value,
  unit,
  detail,
  accent = false,
  index = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  accent?: boolean;
  index?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      className={`metric-cell${accent ? " metric-lead" : ""}`}
      role="group"
      aria-label={label}
    >
      <p className="metric-label">
        <span className="metric-index">0{index + 1}</span>
        {label}
      </p>
      <motion.p
        className="metric-value"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: reduced ? 0 : index * 0.05,
          duration: reduced ? 0 : 0.22,
        }}
      >
        <span className="metric-type">{value}</span>
        {unit && <span className="metric-unit">{unit}</span>}
      </motion.p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}
