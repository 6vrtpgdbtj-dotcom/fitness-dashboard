import { mapColumns } from "../map-columns";
import { normalizeHeader } from "../header-normalizer";
import { profileColumn } from "../value-profiler";
import { threeTrainerSheets } from "../__fixtures__/three-trainer-sheets";
import type { ConfirmedMapping, MappingInput } from "../types";

const scope = { organizationId: "org-1", sourceConnectionId: "connection-1", sourceTabId: "tab-1" };
const input = (rows: unknown[][], extra: Partial<MappingInput> = {}): MappingInput => ({ ...scope, domain: "registration", tabTitle: "임의 탭", rows, ...extra });
const accepted = (result: ReturnType<typeof mapColumns>, field: string) => result.fields.find((column) => column.field === field);

describe("sheet column discovery", () => {
  it.each([0, 60])("uses the administrator's complete one-column header at row %i before automatic detection", (headerRowIndex) => {
    const rows: unknown[][] = Array.from({ length: headerRowIndex }, () => ["intro"]);
    rows.push(["별명"], ["민수"]);
    const history: ConfirmedMapping[] = [{ ...scope, domain: "member", version: 1, headerRowIndex, columns: [{ sourceHeader: "별명", field: "name" }] }];
    const result = mapColumns(input(rows, { domain: "member" }), history);
    expect(result.headerRowIndex).toBe(headerRowIndex);
    expect(result.fields.map((field) => field.field)).toEqual(["name"]);
    expect(result.missingRequiredFields).toEqual([]);
  });
  it("does not promote a saved header position after its complete schema changes", () => {
    const history: ConfirmedMapping[] = [{ ...scope, domain: "member", version: 1, headerRowIndex: 0, columns: [{ sourceHeader: "별명", field: "name" }] }];
    const result = mapColumns(input([["별명", "new column"], ["민수", "data"]], { domain: "member" }), history);
    expect(result.headerRowIndex).toBeNull();
  });
  it.each(threeTrainerSheets)("maps $tabTitle independently of titles, row offsets and column order", (fixture) => {
    const result = mapColumns(input(fixture.rows, { tabTitle: fixture.tabTitle }), []);
    expect(result.headerRowIndex).toBe(fixture.headerRowIndex);
    expect(accepted(result, "name")?.columnIndex).toBe(fixture.nameColumn);
    expect(accepted(result, "paid_amount")?.columnIndex).toBe(fixture.moneyColumn);
    expect(result.missingRequiredFields).toEqual([]);
  });

  it("keeps an unknown identity unresolved even when values look like member names", () => {
    const result = mapColumns(input([["누군가", "등록일", "실결제금액"], ["김민수", "2026-09-01", 500000]]), []);
    expect(result.missingRequiredFields).toContain("name");
    expect(result.unmappedHeaders).toContain("누군가");
    expect(accepted(result, "name")).toBeUndefined();
  });

  it("normalizes Unicode width, punctuation, spacing and Latin case without losing Korean", () => {
    expect(normalizeHeader("  ＰＴ・회원 명【A】_ / (총액)!  ")).toBe("pt회원명a총액");
  });

  it("gives canonical matches precedence and does not infer a field from numeric values alone", () => {
    const result = mapColumns(input([["name", "paid_amount", "등록일", "미지의 금액"], ["민수", 600000, "2026-09-01", 600000]]), []);
    expect(accepted(result, "name")?.confidence).toBe(0.98);
    expect(accepted(result, "paid_amount")?.confidence).toBe(0.98);
    expect(result.fields[3].field).toBeNull();
  });

  it("does not choose arbitrarily between duplicate target columns", () => {
    const result = mapColumns(input([["회원명", "실결제금액", "결제액", "등록일"], ["민수", 600000, 500000, "2026-09-01"]]), []);
    expect(accepted(result, "paid_amount")).toBeUndefined();
    expect(result.fields[1].reason).toBe("duplicate-target");
    expect(result.fields[2].reason).toBe("duplicate-target");
  });

  it("rejects strong header matches when populated samples contradict their value type", () => {
    const result = mapColumns(input([["회원명", "등록일", "실결제금액"], ["민수", "홍길동", "현금"]]), []);
    expect(accepted(result, "registration_date")).toBeUndefined();
    expect(accepted(result, "paid_amount")).toBeUndefined();
    expect(result.fields[2].reason).toBe("type-conflict");
  });

  it("keeps sheet acquisition labels mapped even when a label such as 재등록 also looks like a status", () => {
    const result = mapColumns(input([
      ["회원명", "등록일", "매출", "유입경로"],
      ["한예정", "2026-08-27", 2750000, "재등록"],
      ["김수미", "2026-08-11", 1100000, "필드"],
    ]), []);
    expect(accepted(result, "acquisition_source")?.reason).toBe("accepted");
  });

  it("returns missing fields for empty or title-only sheets without promoting data rows", () => {
    for (const rows of [[], [[], ["9월 회원 관리"]], [["김민수", 600000, "2026-09-01"]]]) {
      const result = mapColumns(input(rows), []);
      expect(result.headerRowIndex).toBeNull();
      expect(result.missingRequiredFields).toContain("name");
    }
  });

  it.each([
    ["member", ["회원명", "잔여횟수", "누적결제금액"], ["민수", 10, 500000], "remaining_sessions"],
    ["lead", ["고객명", "유입일", "상담결과"], ["민수", "2026-09-01", "상담완료"], "status"],
    ["class", ["성명", "수업일", "차감횟수"], ["민수", "2026-09-01", 1], "deducted_sessions"],
  ] as const)("maps the %s domain dictionary", (domain, headers, row, field) => {
    const result = mapColumns(input([[...headers], [...row]], { domain }), []);
    expect(accepted(result, field)).toBeDefined();
    expect(result.missingRequiredFields).toEqual([]);
  });

  it("accepts an external member identity when the member name is absent", () => {
    const result = mapColumns(input([["회원ID", "등록일"], ["M-123", "2026-09-01"]]), []);
    expect(result.missingRequiredFields).not.toContain("name");
  });

  it("fingerprints the ordered schema, not sample values or tab display titles", () => {
    const a = mapColumns(input([["회원명", "매출"], ["민수", 10]]), []);
    const b = mapColumns(input([["회원 명", "매출"], ["서연", 50]], { tabTitle: "새 이름" }), []);
    const c = mapColumns(input([["매출", "회원명"], [10, "민수"]]), []);
    expect(a.mappingFingerprint).toBe(b.mappingFingerprint);
    expect(a.mappingFingerprint).not.toBe(c.mappingFingerprint);
  });

  it("does not auto-accept ambiguous similar date fields", () => {
    const result = mapColumns(input([["회원명", "등록일", "등록예정날짜"], ["민수", "2026-09-01", "2026-09-20"]]), []);
    expect(result.fields[2].field).toBeNull();
    for (const column of result.fields.filter((field) => field.field)) {
      expect(column.confidence).toBeGreaterThanOrEqual(0.88);
      expect(column.margin).toBeGreaterThanOrEqual(0.12);
    }
  });

  it("masks phone columns even when a spreadsheet drops their leading zero", () => {
    const result = mapColumns(input([["회원명", "연락처"], ["민수", 1012345678]], { domain: "member" }), []);
    expect(result.fields[1].sampleValues).toEqual(["***-****-5678"]);
  });
});

describe("confirmed mapping history", () => {
  const history: ConfirmedMapping[] = [{ ...scope, domain: "registration", version: 1, columns: [{ sourceHeader: "누군가", field: "name" }, { sourceHeader: "매출", field: "paid_amount" }] }];

  it("reuses confirmed headers at score 1 across reordering and extra columns", () => {
    const result = mapColumns(input([["매출", "등록일", "누군가", "추가"], [500000, "2026-09-01", "민수", ""]]), history);
    expect(accepted(result, "name")).toMatchObject({ columnIndex: 2, confidence: 1, match: "history" });
  });

  it("does not reuse another tenant, source, tab or domain's confirmation", () => {
    for (const change of [{ organizationId: "other" }, { sourceConnectionId: "other" }, { sourceTabId: "other" }, { domain: "lead" as const }]) {
      const result = mapColumns(input([["누군가", "매출", "등록일"], ["민수", 10, "2026-09-01"]]), [{ ...history[0], ...change }]);
      expect(accepted(result, "name")).toBeUndefined();
    }
  });

  it("honors the latest explicit unmapped correction without mutating history", () => {
    const newer: ConfirmedMapping = { ...history[0], version: 2, columns: [{ sourceHeader: "회원명", field: null }] };
    Object.freeze(newer.columns);
    const result = mapColumns(input([["회원명", "등록일"], ["민수", "2026-09-01"]]), [newer, history[0]]);
    expect(accepted(result, "name")).toBeUndefined();
    expect(newer.columns).toEqual([{ sourceHeader: "회원명", field: null }]);
  });

  it("never reuses a normalized duplicate header by position", () => {
    const result = mapColumns(input([["누군가", "누 군가", "등록일"], ["민수", "코치", "2026-09-01"]]), history);
    expect(accepted(result, "name")).toBeUndefined();
  });

  it("restores ordered duplicate-header confirmations when the complete schema is unchanged", () => {
    const result = mapColumns(input([["회원명", "메모", "메모"], ["민수", "내부 메모", "운동 주의사항"]], { domain: "member" }), [{
      ...scope, domain: "member", version: 1, headerRowIndex: 0,
      columns: [{ sourceHeader: "회원명", field: "name" }, { sourceHeader: "메모", field: null }, { sourceHeader: "메모", field: "notes" }],
    }]);
    expect(result.fields.map((column) => column.field)).toEqual(["name", null, "notes"]);
    expect(result.fields[1]).toMatchObject({ confidence: 1, match: "history", reason: "confirmed-unmapped" });
    expect(result.fields[2]).toMatchObject({ confidence: 1, match: "history", reason: "accepted" });
  });

  it.each([
    { rows: [["회원명", "메모", "메모", "추가"], ["민수", "내부", "운동", ""]] },
    { rows: [["메모", "회원명", "메모"], ["내부", "민수", "운동"]] },
    { rows: [[], ["회원명", "메모", "메모"], ["민수", "내부", "운동"]] },
  ])("does not carry duplicate positions across a schema change: %j", ({ rows }) => {
    const result = mapColumns(input(rows, { domain: "member" }), [{
      ...scope, domain: "member", version: 1, headerRowIndex: 0,
      columns: [{ sourceHeader: "회원명", field: "name" }, { sourceHeader: "메모", field: null }, { sourceHeader: "메모", field: "notes" }],
    }]);
    expect(accepted(result, "name")).toBeDefined();
    expect(accepted(result, "notes")).toBeUndefined();
    expect(result.fields.filter((column) => column.sourceHeader === "메모").every((column) => column.reason === "duplicate-header")).toBe(true);
  });
});

describe("column value profiling", () => {
  it.each([
    [[null, "", "  ", "2026-09-01", "2026.09.02"], "date", 2],
    [[10, "20", 0], "integer", 3],
    [["₩600,000", "-10,000원", "1,000.50"], "money", 3],
    [["10%", "22.5%"], "percentage", 2],
    [["상담완료", "미등록"], "status", 2],
    [["M-123", "M-124", "00123"], "identifier", 3],
    [["김민수", "이서연"], "freeText", 2],
    [["2026-02-30", "2026-13-01"], "freeText", 2],
  ])("profiles %j as %s", (values, kind, count) => {
    expect(profileColumn(values as unknown[])).toMatchObject({ kind, nonEmptyCount: count, confidence: 1 });
  });

  it("retains mixed-type ratios and reports empty columns without certainty", () => {
    expect(profileColumn([10, "현금"])).toMatchObject({ confidence: 0.5, ratios: { integer: 0.5, freeText: 0.5 } });
    expect(profileColumn([null, " ", undefined])).toMatchObject({ kind: "empty", confidence: 0, nonEmptyCount: 0 });
  });
});
