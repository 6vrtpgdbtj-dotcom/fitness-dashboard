import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RecordReviewTable } from "../record-review-table";
import { ConnectionControls } from "../connection-controls";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })); refresh.mockReset(); });
it("shows source fields and submits a selected correction", async () => {
  render(<RecordReviewTable records={[{ id: "r1", domain: "member", name: "Kim", tab_title: "회원 원본", record_status: "review_required", issues: [{ field: "name", code: "required", message: "required" }], source_fields: [{ sourceHeader: "성함", field: "name" }] }]} members={[]} />);
  expect(screen.getByText("회원 원본")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "검토" }));
  fireEvent.change(screen.getByLabelText("수정값"), { target: { value: "Kim corrected" } });
  fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/review/r1", expect.objectContaining({ body: JSON.stringify({ action: "correct", domain: "member", fields: { name: "Kim corrected" } }) })));
});
it("requires typed confirmation and supports cancel before historical deletion", async () => {
  render(<ConnectionControls connection={{ id: "s1", display_name: "Main", is_active: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "원본 이력 삭제" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "영구 삭제" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "원본 이력 삭제" }));
  fireEvent.change(screen.getByLabelText("확인 문구"), { target: { value: "DELETE HISTORY" } });
  fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/review/s1", expect.objectContaining({ body: JSON.stringify({ action: "delete_history", confirmation: "DELETE HISTORY" }) })));
});
