import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import DemoPage from "../page";

afterEach(cleanup);

it.each([
  { balance: "unknown", detail: "잔여 세션 미확인 · 3명 기록 필요" },
  { balance: "partial", detail: "확인된 잔여 11회 · 2명 미확인" },
])(
  "shows the $balance sample balance case with a persistent fictional-data label",
  async ({ balance, detail }) => {
    render(
      await DemoPage({
        searchParams: Promise.resolve({ role: "trainer", balance }),
      }),
    );
    expect(screen.getByText("샘플 화면")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "담당 회원" })).getByText(
        detail,
      ),
    ).toBeInTheDocument();
  },
);

it("shows the renewed sample member's current 11 sessions in inventory", async () => {
  render(
    await DemoPage({
      searchParams: Promise.resolve({
        role: "trainer",
        balance: "renewed",
        view: "members",
      }),
    }),
  );
  const row = screen.getByRole("row", { name: /샘플 회원 01/ });
  expect(within(row).getByText("11회")).toBeInTheDocument();
  expect(screen.queryByLabelText("시작일")).not.toBeInTheDocument();
});

it("removes the renewed sample member from the follow-up queue", async () => {
  render(
    await DemoPage({
      searchParams: Promise.resolve({ role: "trainer", balance: "renewed" }),
    }),
  );
  expect(
    screen.queryByRole("row", { name: /샘플 회원 01/ }),
  ).not.toBeInTheDocument();
});
