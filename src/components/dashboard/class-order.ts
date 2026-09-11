import type { ClassRow } from "@/features/analytics/types";

const timeKey = (row: ClassRow) => {
  if (!row.starts_at) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(row.starts_at);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

export const sortTodayClasses = (rows: ClassRow[]) =>
  [...rows].sort((a, b) => timeKey(a) - timeKey(b));

export const sortPeriodClasses = (rows: ClassRow[]) =>
  [...rows].sort(
    (a, b) =>
      (b.class_date ?? "").localeCompare(a.class_date ?? "") ||
      timeKey(a) - timeKey(b),
  );
