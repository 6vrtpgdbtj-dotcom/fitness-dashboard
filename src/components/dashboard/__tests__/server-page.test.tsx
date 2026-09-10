import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildDashboardData } from "@/features/analytics/aggregate";
import { ServerDashboardPage } from "../server-page";
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const boundary = vi.hoisted(() => ({
  scope: {
    id: "verified-user",
    role: "trainer" as const,
    trainerId: "verified-trainer",
  },
  receivedScope: null as unknown,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => boundary.scope,
}));
vi.mock("@/features/analytics/queries", () => ({
  getDashboardData: async (
    scope: typeof boundary.scope,
    period: { start: string; end: string },
  ) => {
    boundary.receivedScope = scope;
    return buildDashboardData(
      {
        members: [],
        registrations: [],
        leads: [],
        classes: [],
        trainers: [],
        connections: [],
      },
      scope,
      period,
      "2026-09-08",
    );
  },
}));
afterEach(cleanup);
it("takes scope only from requireUser and visibly rejects an invalid URL date range", async () => {
  const maliciousQuery = {
    start: "2026-09-30",
    end: "2026-09-01",
    trainerId: "other-trainer",
    role: "admin",
  };
  render(
    await ServerDashboardPage({
      searchParams: Promise.resolve(maliciousQuery),
      kind: "registrations",
    }),
  );
  expect(boundary.receivedScope).toEqual({
    id: "verified-user",
    role: "trainer",
    trainerId: "verified-trainer",
  });
  expect(screen.getByRole("alert")).toHaveTextContent("날짜");
  expect(
    screen.queryByRole("link", { name: "시트 연결" }),
  ).not.toBeInTheDocument();
});
it("does not offer or validate a date filter for the current members inventory", async () => {
  render(
    await ServerDashboardPage({
      searchParams: Promise.resolve({ start: "not-a-date", end: "2026-09-01" }),
      kind: "members",
    }),
  );
  expect(screen.queryByLabelText("시작일")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("종료일")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "기간 적용" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/조회 기간/)).not.toBeInTheDocument();
});
it.each(["registrations", "leads", "classes"] as const)(
  "retains the date filter for dated %s records",
  async (kind) => {
    render(
      await ServerDashboardPage({
        searchParams: Promise.resolve({
          start: "2026-09-01",
          end: "2026-09-30",
        }),
        kind,
      }),
    );
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-09-30");
    expect(
      screen.getByRole("button", { name: "기간 적용" }),
    ).toBeInTheDocument();
  },
);
