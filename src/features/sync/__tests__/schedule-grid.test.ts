// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractScheduleGrid } from "../sheet-pipeline";

describe("daily schedule grid extraction", () => {
  it("finds the trainer header after a leading blank row", () => {
    const rows = [
      [""],
      ["", "", "지세환", "", "박세준", "", "정윤수", ""],
      ["", "08:00", "", "", "이정임25/50", "", "", ""],
      ["", "17:00", "", "", "", "", "김민정 10/20", ""],
    ];

    expect(
      extractScheduleGrid(rows, "11", "중산점 스케줄 26.09", "2026-09-11"),
    ).toEqual([
      ["회원명", "수업일", "수업시작시간", "담당트레이너", "잔여횟수", "수업상태", "수업ID"],
      ["이정임", "2026-09-11", "08:00", "박세준", 25, "완료", "schedule|%EC%9D%B4%EC%A0%95%EC%9E%84|2026-09-11|08:00|%EB%B0%95%EC%84%B8%EC%A4%80"],
      ["김민정", "2026-09-11", "17:00", "정윤수", 10, "완료", "schedule|%EA%B9%80%EB%AF%BC%EC%A0%95|2026-09-11|17:00|%EC%A0%95%EC%9C%A4%EC%88%98"],
    ]);
  });
});
