import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => navigation }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("shows trainer navigation without administrator settings", () => {
  render(
    <AppShell role="trainer" displayName="정윤수">
      <div>개인 현황</div>
    </AppShell>
  );

  expect(screen.getByText("개인 현황")).toBeInTheDocument();
  expect(screen.queryByText("시트 연결")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
});

it("waits for server sign-out before redirecting and clearing the router cache", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    expect(url).toBe("/auth/signout"); expect(options.method).toBe("POST");
    return new Promise<Response>(resolve => { finish = resolve; });
  }));
  render(<AppShell role="trainer" displayName="트레이너"><p>현황</p></AppShell>);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(screen.getByRole("button", { name: "로그아웃 중…" })).toBeDisabled();
  expect(navigation.replace).not.toHaveBeenCalled();
  finish(new Response(null, { status: 200 }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  expect(navigation.refresh).toHaveBeenCalled();
});

it("shows logout failure without navigating and allows retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  render(<AppShell role="trainer" displayName="트레이너"><p>현황</p></AppShell>);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다시 시도");
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
});

it("shows administrator-only settings for administrators", () => {
  render(
    <AppShell role="admin" displayName="관리자">
      <div>운영 현황</div>
    </AppShell>
  );

  expect(screen.getByText("시트 연결")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "데이터 점검" })[0]).toHaveAttribute("href", "/settings/data-review");
  expect(screen.getAllByRole("link", { name: "사용자 관리" })[0]).toHaveAttribute("href", "/settings/users");
});
