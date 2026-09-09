import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TrainerForm } from "../trainer-form";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })); });
it("creates an approved first-login invitation with an explicit active state", async () => {
  render(<TrainerForm trainers={[]} connections={[]} />);
  fireEvent.change(screen.getByLabelText("Google 이메일"), { target: { value: "coach@example.com" } });
  fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "Coach" } });
  fireEvent.click(screen.getByRole("button", { name: "초대 등록" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/trainers", expect.objectContaining({ body: JSON.stringify({ action: "invite", email: "coach@example.com", displayName: "Coach", active: true }) })));
});
it("shows a server error without claiming the invitation succeeded", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: "중복 초대입니다." }) } as Response);
  render(<TrainerForm trainers={[]} connections={[]} />);
  fireEvent.change(screen.getByLabelText("Google 이메일"), { target: { value: "coach@example.com" } });
  fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "Coach" } });
  fireEvent.click(screen.getByRole("button", { name: "초대 등록" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("중복 초대입니다.");
});
