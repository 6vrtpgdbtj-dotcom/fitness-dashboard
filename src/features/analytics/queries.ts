import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { UserScope } from "@/lib/auth/user-scope";
import { buildDashboardData, parsePeriod } from "./aggregate";
import { readAnalyticsRows } from "./repository";
import type { DashboardData, DateRange } from "./types";

/** scope must originate at requireUser(). URL parameters are never an authority. */
export async function getDashboardData(
  scope: UserScope,
  period: DateRange,
): Promise<DashboardData> {
  if (!parsePeriod(period.start, period.end)) throw new Error("invalid_period");
  const { rows, realtimeTopic } = await readAnalyticsRows(
    await createClient(),
    scope,
  );
  return { ...buildDashboardData(rows, scope, period), realtimeTopic };
}
