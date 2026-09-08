import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DashboardView } from "../dashboard-view";
import { buildDashboardData } from "@/features/analytics/aggregate";
import type { AnalyticsRows } from "@/features/analytics/types";
afterEach(cleanup);
const scope = { id: "admin", role: "admin" as const, trainerId: null };
const rows: AnalyticsRows = {
  members: [],
  classes: [],
  leads: [],
  connections: [],
  trainers: [
    { id: "a", display_name: "트레이너 A" },
    { id: "b", display_name: "트레이너 B" },
  ],
  registrations: [
    {
      id: "r1",
      trainer_id: "a",
      record_status: "valid",
      member_id: null,
      registration_date: "2026-09-01",
      registration_type: "new",
      paid_amount: 100000,
      registered_sessions: 10,
      acquisition_source: null,
      status: "paid",
    },
    {
      id: "r2",
      trainer_id: "b",
      record_status: "valid",
      member_id: null,
      registration_date: "2026-09-01",
      registration_type: "renewal",
      paid_amount: 200000,
      registered_sessions: 10,
      acquisition_source: null,
      status: "paid",
    },
  ],
};
it("updates linked metrics after a trainer selection and validates reversed dates", () => {
  render(
    <DashboardView
      data={buildDashboardData(
        rows,
        scope,
        { start: "2026-09-01", end: "2026-09-30" },
        "2026-09-08",
      )}
      scope={scope}
    />,
  );
  expect(
    within(
      screen.getByRole("group", { name: "선택 기간 결제 매출" }),
    ).getByText("300,000"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("담당 트레이너"), {
    target: { value: "a" },
  });
  expect(
    within(
      screen.getByRole("group", { name: "선택 기간 결제 매출" }),
    ).getByText("100,000"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "기간 적용" }));
  expect(screen.getByRole("alert")).toHaveTextContent("날짜");
});
it("renders trainer priorities with no administrative filters or connection action", () => {
  const trainer = { id: "user-a", role: "trainer" as const, trainerId: "a" };
  render(
    <DashboardView
      data={buildDashboardData(
        rows,
        trainer,
        { start: "2026-09-01", end: "2026-09-30" },
        "2026-09-08",
      )}
      scope={trainer}
    />,
  );
  expect(screen.queryByLabelText("담당 트레이너")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Google 시트 연결" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /오늘의 수업/ }),
  ).toBeInTheDocument();
});
