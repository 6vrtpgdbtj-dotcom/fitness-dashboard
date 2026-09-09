import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/app-shell";

it("shows trainer navigation without administrator settings", () => {
  render(
    <AppShell role="trainer" displayName="정윤수">
      <div>개인 현황</div>
    </AppShell>
  );

  expect(screen.getByText("개인 현황")).toBeInTheDocument();
  expect(screen.queryByText("시트 연결")).not.toBeInTheDocument();
});

it("shows administrator-only settings for administrators", () => {
  render(
    <AppShell role="admin" displayName="관리자">
      <div>운영 현황</div>
    </AppShell>
  );

  expect(screen.getByText("시트 연결")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "데이터 점검" })[0]).toHaveAttribute("href", "/settings/data-review");
  expect(screen.getAllByRole("link", { name: "사용자 관리" })[0]).toHaveAttribute("href", "/settings/users");
});
