import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../aggregate";

describe("schedule operation markers", () => {
  it("does not count a stale half-day marker as a class", () => {
    const data = buildDashboardData(
      {
        members: [], registrations: [], leads: [], trainers: [], connections: [],
        classes: [{
          id: "half-day", trainer_id: "trainer", record_status: "valid",
          external_class_id: "schedule|%EC%98%A4%ED%9B%84%EB%B0%98%EC%B0%A8|2026-09-11|13:00|%EB%B0%95%EC%84%B8%EC%A4%80",
          member_id: null, class_date: "2026-09-11", starts_at: "2026-09-11T04:00:00.000Z",
          status: "completed", deducted_sessions: null, remaining_sessions: null,
        }],
      },
      { id: "admin", role: "admin", trainerId: null },
      { start: "2026-09-11", end: "2026-09-11" },
      "2026-09-11",
    );

    expect(data.todayClasses).toEqual([]);
    expect(data.metrics.completedClasses).toBe(0);
  });
});
