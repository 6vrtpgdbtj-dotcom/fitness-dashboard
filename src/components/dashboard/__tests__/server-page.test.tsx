import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildDashboardData } from "@/features/analytics/aggregate";
import { ServerDashboardPage } from "../server-page";
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
