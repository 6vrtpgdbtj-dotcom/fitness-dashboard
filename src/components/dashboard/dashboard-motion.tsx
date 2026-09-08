"use client";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function DashboardMotion({
  children,
  role,
}: {
  children: ReactNode;
  role: "admin" | "trainer";
}) {
  const reduced = useReducedMotion();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={`dashboard-flow dashboard-${role}`}
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              delayChildren: reduced ? 0 : 0.04,
              staggerChildren: reduced ? 0 : 0.06,
            },
          },
        }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
export function MotionSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      className={className}
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: reduced ? 0 : 0.22, ease: "easeOut" },
        },
      }}
    >
      {children}
    </motion.section>
  );
}
