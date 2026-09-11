import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardData } from "@/features/analytics/types";
import { PtRevenueLedger } from "../pt-revenue-ledger";

afterEach(cleanup);

describe("PT revenue ledger", () => {
  it("leads with team revenue and exposes trainer, lifecycle, and sheet-source evidence", () => {
    const data = {
      period: { start: "2026-08-01", end: "2026-08-31" },
      metrics: { periodRevenue: 7450000 },
      trainerComparison: [
        { id: "t1", name: "정윤수", revenue: 3450000, newRevenue: 700000, renewedRevenue: 2750000, sourceRevenue: { OT: 600000, 필드: 100000 } },
        { id: "t2", name: "박세준", revenue: 1100000, newRevenue: 1100000, renewedRevenue: 0, sourceRevenue: { 필드: 1100000 } },
      ],
    } as DashboardData;
    render(<PtRevenueLedger data={data} />);
    expect(screen.getByRole("heading", { name: "PT 팀 매출" })).toBeVisible();
    expect(screen.getByRole("group", { name: "선택 기간 PT 매출" })).toHaveTextContent("7,450,000원");
    expect(screen.getByText("정윤수")).toBeVisible();
    expect(screen.getByText("신규 매출")).toBeVisible();
    expect(screen.getByText("재등록 매출")).toBeVisible();
    expect(screen.getByText("OT 매출")).toBeVisible();
    expect(screen.getByText("미배정·기타 2,900,000원")).toBeVisible();
  });
});
