import { describe, expect, it } from "vitest";
import type { ClassRow } from "@/features/analytics/types";
import { sortPeriodClasses, sortTodayClasses } from "../class-order";

const row = (id: string, classDate: string, startsAt: string | null): ClassRow => ({
  id,
  trainer_id: null,
  record_status: "valid",
  member_id: null,
  class_date: classDate,
  starts_at: startsAt,
  status: "scheduled",
  deducted_sessions: null,
  remaining_sessions: null,
});

describe("class ordering", () => {
  it("places today's classes in Korean schedule time order with unknown times last", () => {
    const unknown = row("unknown", "2026-09-11", null);
    const tenThirty = row("ten-thirty", "2026-09-11", "2026-09-11T10:30:00+09:00");
    const nine = row("nine", "2026-09-11", "2026-09-11T09:00:00+09:00");
    expect(sortTodayClasses([unknown, tenThirty, nine]).map((item) => item.id)).toEqual(["nine", "ten-thirty", "unknown"]);
  });

  it("keeps recent dates first and early sessions first within each date", () => {
    const olderNine = row("older", "2026-09-10", "2026-09-10T09:00:00+09:00");
    const newerEleven = row("newer-eleven", "2026-09-11", "2026-09-11T11:00:00+09:00");
    const newerEight = row("newer-eight", "2026-09-11", "2026-09-11T08:00:00+09:00");
    expect(sortPeriodClasses([olderNine, newerEleven, newerEight]).map((item) => item.id)).toEqual(["newer-eight", "newer-eleven", "older"]);
  });
});
