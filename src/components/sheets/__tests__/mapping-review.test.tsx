import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MappingReview } from "../mapping-review";
import { mapColumns } from "@/features/mapping/map-columns";
import type { SaveMappingInput } from "@/features/mapping/types";

vi.mock("@/features/mapping/save-mapping-version", () => ({ saveMappingVersion: vi.fn() }));
afterEach(cleanup);
const input = { organizationId: "org", sourceConnectionId: "connection", sourceTabId: "tab", domain: "registration" as const, tabTitle: "등록", rows: [["누군가", "등록일", "매출"], ["민수", "2026-09-01", 500000]] };

it("shows samples, proposals and confidence, then saves the administrator's correction as a new version", async () => {
  const saved: SaveMappingInput[] = [];
  const result = mapColumns(input, []);
  render(<MappingReview input={input} result={result} onSave={async (value) => { saved.push(value); return { id: "new-version", version: 2 }; }} />);
  expect(screen.getByText("민수")).toBeInTheDocument();
  expect(screen.getByText("500000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "새 매핑 버전 저장" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("1열 누군가 표준 필드"), { target: { value: "name" } });
  fireEvent.click(screen.getByRole("button", { name: "새 매핑 버전 저장" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("버전 2"));
  expect(saved[0].columns).toEqual([{ sourceHeader: "누군가", field: "name" }, { sourceHeader: "등록일", field: "registration_date" }, { sourceHeader: "매출", field: "paid_amount" }]);
  expect(result.fields[0].field).toBeNull();
});

it("blocks duplicate target fields and reports a failed save without claiming success", async () => {
  render(<MappingReview input={input} result={mapColumns(input, [])} onSave={async () => { throw new Error("offline"); }} />);
  fireEvent.change(screen.getByLabelText("1열 누군가 표준 필드"), { target: { value: "registration_date" } });
  expect(screen.getByRole("button", { name: "새 매핑 버전 저장" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("1열 누군가 표준 필드"), { target: { value: "name" } });
  fireEvent.click(screen.getByRole("button", { name: "새 매핑 버전 저장" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했습니다"));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows only masked telephone samples", () => {
  const memberInput = { ...input, domain: "member" as const, rows: [["회원명", "연락처"], ["민수", "010-1234-5678"]] };
  render(<MappingReview input={memberInput} result={mapColumns(memberInput, [])} />);
  expect(screen.getByText("***-****-5678")).toBeInTheDocument();
  expect(screen.queryByText("010-1234-5678")).not.toBeInTheDocument();
});

it("resets stale selections when a new confirmation arrives for the same schema", () => {
  const initial = mapColumns(input, []);
  const { rerender } = render(<MappingReview input={input} result={initial} />);
  const confirmed = mapColumns(input, [{ ...input, version: 1, columns: [{ sourceHeader: "누군가", field: "name" }] }]);
  rerender(<MappingReview input={input} result={confirmed} />);
  expect(screen.getByLabelText("1열 누군가 표준 필드")).toHaveValue("name");
});
