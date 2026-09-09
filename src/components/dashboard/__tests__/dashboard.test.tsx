import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RevenueChart } from "../revenue-chart";
import { ConversionFunnel } from "../conversion-funnel";
import { RenewalTable } from "../renewal-table";
import { SyncPulse } from "../sync-pulse";
afterEach(cleanup);

describe("accessible operational components", () => {
  it("provides exact chart values by keyboard and an accessible data table", () => {
    render(
      <RevenueChart
        data={[
          {
            month: "2026-09",
            newRevenue: 100000,
            renewedRevenue: 200000,
            additionalRevenue: 0,
            refunds: 5000,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /9월.*신규.*100,000/ }));
    expect(screen.getByRole("status")).toHaveTextContent("200,000");
    fireEvent.click(screen.getByText("표로 보기"));
    expect(
      within(screen.getByRole("table", { name: "기간별 등록 매출" })).getByText(
        "5,000원",
      ),
    ).toBeInTheDocument();
  });
  it("labels unknown conversion and explains its denominator", () => {
    render(
      <ConversionFunnel
        data={{ leads: 0, consulted: 0, converted: 0 }}
        sources={[]}
      />,
    );
    expect(
      screen.getByText("상담 완료 기록이 아직 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/상담일이 있는 유효한 완료 상담/),
    ).toBeInTheDocument();
  });
  it("keeps cross-year month targets uniquely named inside a keyboard-accessible scroll region", () => {
    render(
      <RevenueChart
        data={[
          {
            month: "2025-09",
            newRevenue: 0,
            renewedRevenue: 0,
            additionalRevenue: 0,
            refunds: 0,
          },
          {
            month: "2026-09",
            newRevenue: 100000,
            renewedRevenue: 200000,
            additionalRevenue: 0,
            refunds: 0,
          },
        ]}
      />,
    );
    const chart = screen.getByRole("region", {
      name: /월별 매출.*좌우 스크롤/,
    });
    expect(chart).toHaveAttribute("tabindex", "0");
    fireEvent.focus(within(chart).getByRole("button", { name: /^2025년 9월/ }));
    expect(screen.getByRole("status")).toHaveTextContent("2025.09");
    fireEvent.focus(within(chart).getByRole("button", { name: /^2026년 9월/ }));
    expect(screen.getByRole("status")).toHaveTextContent("2026.09");
  });
  it("shows renewal empty state without fabricated members", () => {
    render(<RenewalTable members={[]} role="trainer" />);
    expect(
      screen.getByText("현재 재등록 확인 대상이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("retains the successful refresh time while identifying a failed source", () => {
    render(
      <SyncPulse
        connections={[
          {
            id: "a",
            display_name: "성공 시트",
            status: "succeeded",
            last_successful_sync_at: "2026-09-08T02:00:00Z",
          },
          {
            id: "b",
            display_name: "실패 시트",
            status: "failed",
            last_successful_sync_at: "2026-09-07T01:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("일부 연결 확인 필요")).toBeInTheDocument();
    expect(screen.getByText("실패 시트")).toBeInTheDocument();
    expect(screen.getByText(/성공 데이터는 계속 표시/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "시트 연결 확인" }),
    ).toHaveAttribute("href", "/settings/sheets");
  });
});
