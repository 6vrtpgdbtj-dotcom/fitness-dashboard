import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Login from "@/app/login/page";

vi.mock("@/app/login/actions", () => ({ signInWithGoogle: async () => {} }));
afterEach(cleanup);

it("offers Google login with the approved-account requirement", async () => {
  render(await Login({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("button", { name: "Google 계정으로 로그인" })).toBeInTheDocument();
  expect(screen.getByText("관리자가 등록한 Google 계정으로 로그인해 주세요.")).toBeInTheDocument();
});

it("shows a useful message when access has not been approved", async () => {
  render(await Login({ searchParams: Promise.resolve({ error: "not-approved" }) }));
  expect(screen.getByRole("alert")).toHaveTextContent("접근 권한이 아직 없습니다.");
});

it.each(["private-provider-error", "__proto__", "constructor"])("ignores unknown error input %s", async (error) => {
  render(await Login({ searchParams: Promise.resolve({ error }) }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Google 계정으로 로그인" })).toBeInTheDocument();
});
