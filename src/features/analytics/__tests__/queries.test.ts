import { describe, expect, it } from "vitest";
import { buildDashboardData, parsePeriod } from "../aggregate";
import type { AnalyticsRows } from "../types";

const period = { start: "2026-09-01", end: "2026-09-30" };
const base = { trainer_id: "t1", record_status: "valid" as const };
const registration = {
  ...base,
  member_id: "m1",
  registration_date: "2026-09-03",
  registration_type: "new",
  paid_amount: 100000,
  registered_sessions: 10,
  acquisition_source: "소개",
  status: "paid",
};
const lead = {
  ...base,
  member_id: "m1",
  lead_date: "2026-08-31",
  consultation_date: "2026-09-02",
  status: "consulted",
  is_registered: false,
  acquisition_source: "소개",
};
const rows: AnalyticsRows = {
  trainers: [
    { id: "t1", display_name: "트레이너 A" },
    { id: "t2", display_name: "트레이너 B" },
  ],
  members: [
    {
      ...base,
      id: "m1",
      name: "회원 A",
      status: "active",
      remaining_sessions: 4,
      expected_end_date: null,
    },
    {
      ...base,
      id: "m2",
      trainer_id: "t2",
      name: "회원 B",
      status: "active",
      remaining_sessions: 20,
      expected_end_date: null,
    },
    {
      ...base,
      id: "m3",
      name: "검토 회원",
      status: "active",
      remaining_sessions: 1,
      expected_end_date: null,
      record_status: "review_required",
    },
  ],
  registrations: [
    { ...registration, id: "r1" },
    {
      ...registration,
      id: "r2",
      registration_type: "renewal",
      paid_amount: 200000,
      registered_sessions: 20,
    },
    {
      ...registration,
      id: "r3",
      trainer_id: "t2",
      member_id: "m2",
      paid_amount: 300000,
      registered_sessions: 30,
    },
    { ...registration, id: "refund", paid_amount: 50000, status: "refunded" },
    { ...registration, id: "pending", paid_amount: 999000, status: "pending" },
    {
      ...registration,
      id: "bad",
      paid_amount: 999000,
      record_status: "review_required",
    },
    {
      ...registration,
      id: "old",
      registration_date: "2026-08-03",
      paid_amount: 80000,
    },
  ],
  leads: [
    { ...lead, id: "l1", is_registered: true, status: "registered" },
    { ...lead, id: "l2", status: "not_registered" },
    {
      ...lead,
      id: "l3",
      trainer_id: "t2",
      member_id: "m2",
      is_registered: true,
    },
    {
      ...lead,
      id: "scheduled",
      consultation_date: "2026-09-05",
      status: "scheduled",
    },
    { ...lead, id: "undated", consultation_date: null, is_registered: true },
    {
      ...lead,
      id: "bad",
      record_status: "review_required",
      is_registered: true,
    },
  ],
  classes: [
    {
      ...base,
      id: "c1",
      member_id: "m1",
      class_date: "2026-09-08",
      starts_at: "2026-09-08T01:00:00Z",
      status: "completed",
      deducted_sessions: 2,
      remaining_sessions: 3,
    },
    {
      ...base,
      id: "c2",
      member_id: "m1",
      class_date: "2026-09-01",
      starts_at: null,
      status: "completed",
      deducted_sessions: 2,
      remaining_sessions: 5,
    },
    {
      ...base,
      id: "c3",
      trainer_id: "t2",
      member_id: "m2",
      class_date: "2026-09-08",
      starts_at: "2026-09-08T05:00:00Z",
      status: "scheduled",
      deducted_sessions: null,
      remaining_sessions: null,
    },
    {
      ...base,
      id: "c4",
      member_id: "m1",
      class_date: "2026-09-08",
      starts_at: null,
      status: "cancelled",
      deducted_sessions: 1,
      remaining_sessions: 2,
    },
  ],
  connections: [
    {
      id: "s1",
      display_name: "시트 A",
      status: "succeeded",
      last_successful_sync_at: "2026-09-08T02:00:00Z",
    },
    {
      id: "s2",
      display_name: "시트 B",
      status: "failed",
      last_successful_sync_at: "2026-09-07T02:00:00Z",
    },
  ],
};

describe("scoped operational analytics", () => {
  it("separates refunds and registration types, excluding pending and review records", () => {
    const data = buildDashboardData(
      rows,
      { id: "a", role: "admin", trainerId: null },
      period,
      "2026-09-08",
    );
    expect(data.metrics).toMatchObject({
      periodRevenue: 600000,
      totalRevenue: 680000,
      refunds: 50000,
      newRegistrations: 2,
      renewedRegistrations: 1,
      averagePayment: 200000,
      averageSessions: 20,
      completedClasses: 2,
      assignedMembers: 2,
    });
    expect(data.revenue).toEqual([
      {
        month: "2026-09",
        newRevenue: 400000,
        renewedRevenue: 200000,
        additionalRevenue: 0,
        refunds: 50000,
      },
    ]);
    expect(data.trainerComparison.map((item) => item.revenue)).toEqual([
      300000, 300000,
    ]);
  });
  it("uses only dated completed consultations for conversion, including not-registered outcomes", () => {
    const data = buildDashboardData(
      rows,
      { id: "a", role: "admin", trainerId: null },
      period,
      "2026-09-08",
    );
    expect(data.funnel).toMatchObject({ consulted: 3, converted: 2 });
    expect(data.metrics.conversionRate).toBeCloseTo(66.6667, 3);
    expect(data.sources).toEqual([
      {
        source: "소개",
        consulted: 3,
        converted: 2,
        conversionRate: (100 * 2) / 3,
      },
    ]);
  });
  it("scopes every aggregate and detail to the verified trainer and hides connection metadata", () => {
    const data = buildDashboardData(
      rows,
      { id: "u1", role: "trainer", trainerId: "t1" },
      period,
      "2026-09-08",
    );
    expect(data.metrics).toMatchObject({
      periodRevenue: 300000,
      newRegistrations: 1,
      conversionRate: 50,
      assignedMembers: 1,
    });
    expect(data.rows.members.map((row) => row.id)).toEqual(["m1"]);
    expect(data.todayClasses.map((row) => row.id)).toEqual(["c1"]);
    expect(data.connections).toEqual([]);
    expect(data.trainerComparison).toEqual([]);
    expect(data.rows.registrations.some((row) => row.trainer_id === "t2")).toBe(
      false,
    );
  });
  it("uses latest completed class balance and a documented 28-day consumption rate for renewal candidates", () => {
    const data = buildDashboardData(
      rows,
      { id: "a", role: "admin", trainerId: null },
      period,
      "2026-09-08",
    );
    expect(data.renewals).toEqual([
      expect.objectContaining({
        id: "m1",
        remainingSessions: 3,
        expectedDepletionDate: "2026-09-29",
        estimateBasis: "pace",
        lastClassDate: "2026-09-08",
      }),
    ]);
    expect(
      data.members.find((member) => member.id === "m2")?.expectedDepletionDate,
    ).toBeNull();
  });
  it("returns unknown ratios for an empty dataset and never authorizes a trainer without an id", () => {
    const empty = {
      members: [],
      registrations: [],
      leads: [],
      classes: [],
      trainers: [],
      connections: [],
    };
    const data = buildDashboardData(
      empty,
      { id: "a", role: "admin", trainerId: null },
      period,
      "2026-09-08",
    );
    expect(data.metrics.conversionRate).toBeNull();
    expect(data.metrics.averagePayment).toBeNull();
    expect(data.metrics.periodRevenue).toBe(0);
    expect(() =>
      buildDashboardData(
        rows,
        { id: "u", role: "trainer", trainerId: null },
        period,
      ),
    ).toThrow();
  });
  it("rejects impossible dates and reversed periods before querying", () => {
    expect(parsePeriod("2026-02-30", "2026-03-01")).toBeNull();
    expect(parsePeriod("2026-09-30", "2026-09-01")).toBeNull();
    expect(parsePeriod("2026-09-01", "2026-09-30")).toEqual(period);
  });
});
