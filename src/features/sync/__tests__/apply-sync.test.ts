import { describe, expect, it } from "vitest";
import { applySync } from "../apply-sync";
import { sourceRecordKey } from "../fingerprint";
import { normalizeMember } from "../normalize-member";
import { normalizeRegistration } from "../normalize-registration";
import { normalizeLead } from "../normalize-lead";
import { normalizeClass } from "../normalize-class";
import { mapColumns } from "../../mapping/map-columns";
import type { AuditEvent, RawSnapshot, StoredRecord, SyncInput, SyncRepository, SyncScope } from "../types";
import type { MappingDomain } from "../../mapping/types";

// This repository double models the persistence contract, including rollback.
function database() {
  let records = new Map<string, StoredRecord>();
  let audits: AuditEvent[] = [];
  const snapshots: RawSnapshot[] = [];
  let failAudit = false;
  const key = (scope: SyncScope, domain: MappingDomain, sourceKey: string) => JSON.stringify([scope, domain, sourceKey]);
  const db: SyncRepository = {
    async insertSnapshot(snapshot) {
      const previous = snapshots.find((entry) => entry.snapshotKey === snapshot.snapshotKey && JSON.stringify(entry.scope) === JSON.stringify(snapshot.scope));
      if (previous) return previous.id;
      const id = `snapshot-${snapshots.length + 1}`;
      snapshots.push({ ...structuredClone(snapshot), id });
      return id;
    },
    async transaction(scope, operation) {
      const nextRecords = structuredClone(records);
      const nextAudits = structuredClone(audits);
      const result = await operation({
        async find(domain, sourceKey) { return nextRecords.get(key(scope, domain, sourceKey)) ?? null; },
        async upsert(record) { nextRecords.set(key(scope, record.domain, record.source_record_key), structuredClone(record)); },
        async appendAudit(event) {
          if (failAudit) throw new Error("database unavailable");
          nextAudits.push(structuredClone(event));
        },
      });
      records = nextRecords;
      audits = nextAudits;
      return result;
    },
  };
  return { db, snapshots, records: () => [...records.values()], audits: () => audits, failAudit: () => { failAudit = true; } };
}

function input(rows: unknown[][], domain: MappingDomain = "registration", fields = ["external_registration_id", "name", "registration_date", "paid_amount"]): SyncInput {
  return {
    organizationId: "org-1", sourceConnectionId: "connection-1", sourceTabId: "tab-1", trainerId: "trainer-1",
    mappingVersionId: "mapping-1", capturedAt: "2026-09-05T12:00:00Z",
    mapping: { domain, headerRowIndex: 0, confidence: 1, missingRequiredFields: [], unmappedHeaders: [], mappingFingerprint: "mapping-hash",
      fields: fields.map((field, columnIndex) => ({ columnIndex, sourceHeader: field, normalizedHeader: field, sampleValues: [], profile: { kind: "empty", nonEmptyCount: 0, confidence: 0, ratios: { date: 0, integer: 0, money: 0, percentage: 0, status: 0, identifier: 0, freeText: 0 } }, field, proposedField: field, confidence: 1, margin: 1, match: "exact", reason: "accepted" })),
    }, rows: [fields, ...rows],
  };
}

describe("sync persistence", () => {
  it.each(["2026년 9월 5일", "2026. 9. 5.", "2026/9/5"])("ingests supported date %s through automatic mapping", async (date) => {
    const db = database();
    const sheet = input([["R1", "민수", date, 600000]]);
    sheet.mapping = mapColumns({ ...sheet, domain: "registration", tabTitle: "등록" });
    expect(sheet.mapping.fields[2].field).toBe("registration_date");
    expect((await applySync(sheet, db.db)).registration.inserted).toBe(1);
    expect(db.records()[0].values.registration_date).toBe("2026-09-05");
  });

  it("keeps valid revenue with an invalid optional end date and retains a warning", async () => {
    const db = database();
    const fields = ["external_registration_id", "name", "registration_date", "paid_amount", "expected_end_date"];
    const result = await applySync(input([["R1", "민수", "2026-09-05", 600000, "미정"]], "registration", fields), db.db);
    expect(result.registration).toMatchObject({ inserted: 1, reviewRequired: 0 });
    expect(db.records()[0]).toMatchObject({ record_status: "valid", values: { paid_amount: 600000, expected_end_date: null } });
    expect(db.records()[0].issues).toContainEqual(expect.objectContaining({ field: "expected_end_date", code: "invalid_date", severity: "warning" }));
    expect(db.audits()[0].issues).toEqual(db.records()[0].issues);
  });

  it.each([
    { domain: "registration" as const, fields: ["name", "registration_date", "paid_amount", "status"], row: ["민수", "2026-09-05", 600000, "정체불명"] },
    { domain: "member" as const, fields: ["name", "birth_date"], row: ["민수", "invalid"] },
  ])("keeps $domain business and identity blockers quarantined", async ({ domain, fields, row }) => {
    const db = database();
    expect((await applySync(input([row], domain, fields), db.db))[domain].reviewRequired).toBe(1);
  });
  it("does not insert duplicates when a snapshot is repeated or rows are sorted", async () => {
    const db = database();
    const rows = [["R1", "민수", "2026-09-01", "₩600,000"], ["R2", "서연", "2026-09-02", "900,000원"]];
    expect((await applySync(input(rows), db.db)).registration.inserted).toBe(2);
    expect((await applySync(input(rows), db.db)).registration).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect((await applySync(input([...rows].reverse()), db.db)).registration).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(db.records()).toHaveLength(2);
    expect(db.snapshots).toHaveLength(2);
    expect(db.audits()).toHaveLength(2);
  });

  it("updates payment with stable business identity and retains the old raw history and audit values", async () => {
    const db = database();
    const fields = ["name", "registration_date", "paid_amount", "product"];
    const first = input([["민수", "2026-09-01", "600,000", "PT10"]], "registration", fields);
    await applySync(first, db.db);
    first.rows[1][2] = "650,000";
    const result = await applySync(first, db.db);
    expect(result.registration.updated).toBe(1);
    expect(db.records()).toHaveLength(1);
    expect(db.records()[0]).toMatchObject({ values: { paid_amount: 650000 }, raw_snapshot_id: "snapshot-2", mapping_version_id: "mapping-1", trainer_id: "trainer-1" });
    expect(db.snapshots[0].sourcePayload.rows[1][2]).toBe("600,000");
    expect(db.audits()[1].changes.paid_amount).toEqual({ before: 600000, after: 650000 });
  });

  it("commits valid rows while invalid required fields remain excluded from analytics", async () => {
    const db = database();
    const result = await applySync(input([["R1", "민수", "2026-09-01", 600000], ["R2", "서연", "2026-02-30", "bad"]]), db.db);
    expect(result.registration).toMatchObject({ inserted: 1, reviewRequired: 1, rejected: 0 });
    expect(db.records().filter((row) => row.record_status === "valid")).toHaveLength(1);
    expect(db.records().find((row) => row.record_status === "review_required")?.issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["registration_date", "paid_amount"]));
  });

  it("rolls back records and audits on storage failure while retaining the immutable snapshot", async () => {
    const db = database();
    db.failAudit();
    await expect(applySync(input([["R1", "민수", "2026-09-01", 600000]]), db.db)).rejects.toThrow("database unavailable");
    expect(db.records()).toHaveLength(0);
    expect(db.audits()).toHaveLength(0);
    expect(db.snapshots).toHaveLength(1);
  });

  it("does not merge indistinguishable business identities into a valid analytical record", async () => {
    const db = database();
    const result = await applySync(input([["동명이인", "2026-09-01", 600000], ["동명이인", "2026-09-01", 900000]], "registration", ["name", "registration_date", "paid_amount"]), db.db);
    expect(result.registration.reviewRequired).toBe(2);
    expect(db.records().filter((row) => row.record_status === "valid")).toHaveLength(0);
    expect(db.records()[0].issues).toContainEqual(expect.objectContaining({ code: "duplicate_identity" }));
    expect(db.snapshots[0].sourcePayload.rows).toHaveLength(3);
  });

  it("uses only accepted mapping fields and flags unresolved required mappings", async () => {
    const db = database();
    const sheet = input([["R1", "민수", "2026-09-01", 600000]]);
    sheet.mapping.fields[2].field = null;
    sheet.mapping.missingRequiredFields = ["registration_date"];
    const result = await applySync(sheet, db.db);
    expect(result.registration.reviewRequired).toBe(1);
    expect(db.records()[0].values.registration_date).toBeUndefined();
  });

  it("redacts full phone numbers from snapshots, normalized values and audit events", async () => {
    const db = database();
    await applySync(input([["M1", "민수", "010-1234-5678", "전화 010 9999 8888"]], "member", ["external_member_id", "name", "phone_last4", "notes"]), db.db);
    expect(db.records()[0].values.phone_last4).toBe("5678");
    expect(JSON.stringify([db.snapshots, db.records(), db.audits()])).not.toMatch(/010[- ]?(1234|9999)/);
  });

  it.each(["02-1234-5678", "(010) 1234-5678", "010/1234/5678", "+82 (10) 1234.5678", "031 123 5678", "+821012345678"])("scrubs %s from raw, text and audit deltas while preserving the mapped suffix", async (phone) => {
    const db = database();
    const fields = ["external_member_id", "name", "phone_last4", "notes"];
    await applySync(input([["M1", "민수", phone, `연락 ${phone}`]], "member", fields), db.db);
    await applySync(input([["M1", "민수", phone, "전화 요청 취소"]], "member", fields), db.db);
    expect(db.snapshots[0].sourcePayload.rows[1]).toEqual(["M1", "민수", "5678", "연락 [전화번호 삭제]"]);
    expect(db.records()[0].values.phone_last4).toBe("5678");
    expect(db.audits()[1].changes.notes).toEqual({ before: "연락 [전화번호 삭제]", after: "전화 요청 취소" });
    expect(normalizeMember({ name: "민수", notes: `연락 ${phone}` }).values.notes).toBe("연락 [전화번호 삭제]");
    expect(JSON.stringify([db.snapshots, db.records(), db.audits()])).not.toContain(phone);
  });

  it("scopes upserts by organization and rejects blank rows without inventing members", async () => {
    const db = database();
    const sheet = input([["R1", "민수", "2026-09-01", 600000], ["", "", "", ""]]);
    expect((await applySync(sheet, db.db)).registration.rejected).toBe(1);
    await applySync({ ...sheet, organizationId: "org-2" }, db.db);
    expect(db.records()).toHaveLength(2);
  });

  it.each([
    { phone: "+82 (0)10-1234-5678", suffix: "5678" },
    { phone: "1588-1234", suffix: "1234" },
  ])("scrubs $phone across snapshot, notes, insertion and legacy update audits", async ({ phone, suffix }) => {
    const db = database();
    const fields = ["external_member_id", "name", "phone_last4", "notes"];
    await applySync(input([["M1", "민수", phone, `연락 ${phone}`]], "member", fields), db.db);
    expect(db.snapshots[0].sourcePayload.rows[1]).toEqual(["M1", "민수", suffix, "연락 [전화번호 삭제]"]);
    expect(db.records()[0].values.notes).toBe("연락 [전화번호 삭제]");
    expect(db.audits()[0].changes.notes).toEqual({ before: null, after: "연락 [전화번호 삭제]" });
    expect(normalizeMember({ name: "민수", notes: phone }).values.notes).toBe("[전화번호 삭제]");
    const previous = db.records()[0];
    await db.db.transaction(db.snapshots[0].scope, async (tx) => {
      await tx.upsert({ ...previous, values: { ...previous.values, notes: `이전 ${phone}` } });
    });
    await applySync(input([["M1", "민수", phone, `변경 ${phone}`]], "member", fields), db.db);
    expect(db.audits()[1].changes.notes).toEqual({ before: "이전 [전화번호 삭제]", after: "변경 [전화번호 삭제]" });
    expect(JSON.stringify([db.snapshots, db.records(), db.audits()])).not.toContain(phone);
  });

  it("preserves dates, money and embedded IDs while scrubbing adjacent phone groups", () => {
    const notes = "2026-09-06 1588-1234 / 600,000원 / ₩15881234 / ID-M01012345678 / R-1588-1234 / 12345678 / 1234-5678";
    expect(normalizeMember({ name: "민수", notes }).values.notes).toBe("2026-09-06 [전화번호 삭제] / 600,000원 / ₩15881234 / ID-M01012345678 / R-1588-1234 / 12345678 / 1234-5678");
  });

  it("scrubs a legacy full phone value before recording it in an audit delta", async () => {
    const db = database();
    const sheet = input([["M1", "민수", "기존 메모"]], "member", ["external_member_id", "name", "notes"]);
    await applySync(sheet, db.db);
    const previous = db.records()[0];
    await db.db.transaction(db.snapshots[0].scope, async (tx) => {
      await tx.upsert({ ...previous, values: { ...previous.values, notes: "연락 (010) 1234-5678" } });
    });
    await applySync(input([["M1", "민수", "취소"]], "member", ["external_member_id", "name", "notes"]), db.db);
    expect(db.audits()[1].changes.notes).toEqual({ before: "연락 [전화번호 삭제]", after: "취소" });
  });

  it("counts only the committed transaction attempt and adds each collision issue once", async () => {
    const db = database();
    const retry = new Error("serialization retry");
    const repository: SyncRepository = { ...db.db, async transaction(scope, operation) {
      try {
        await db.db.transaction(scope, async (tx) => { await operation(tx); throw retry; });
      } catch (error) { if (error !== retry) throw error; }
      return db.db.transaction(scope, operation);
    } };
    const result = await applySync(input([["R1", "민수", "2026-09-01", 600000], ["R2", "서연", "2026-09-01", 500000], ["R2", "서연", "2026-09-01", 700000], ["", "", "", ""]]), repository);
    expect(result.registration).toEqual({ inserted: 1, updated: 0, unchanged: 0, reviewRequired: 2, rejected: 1 });
    expect(db.records().find((record) => record.record_status === "review_required")?.issues.filter((issue) => issue.code === "duplicate_identity")).toHaveLength(1);
    expect(db.audits()).toHaveLength(2);
  });

  it.each([
    { reason: "different join hints", rows: [["R1", "민수", "2026-09-01", 600000], ["R1", "서연", "2026-09-01", 600000]] },
    { reason: "different field issues", rows: [["R1", "민수", "2026-09-01", ""], ["R1", "민수", "2026-09-01", "bad"]] },
  ])("keeps collision selection stable when equal values have $reason", async ({ rows }) => {
    const db = database();
    await applySync(input(rows), db.db);
    const first = db.records()[0];
    await applySync(input([...rows].reverse()), db.db);
    expect(db.records()[0].hints).toEqual(first.hints);
    expect(db.records()[0].issues).toEqual(first.issues);
    expect(db.audits()).toHaveLength(1);
  });

  it("does not update or audit a class when a local time changes to its equivalent UTC timestamp", async () => {
    const db = database();
    const fields = ["external_class_id", "name", "class_date", "starts_at"];
    await applySync(input([["C1", "민수", "2026-09-01", "오후 2:30"]], "class", fields), db.db);
    const result = await applySync(input([["C1", "민수", "2026-09-01", "2026-09-01T05:30:00Z"]], "class", fields), db.db);
    expect(result.class).toMatchObject({ unchanged: 1, updated: 0 });
    expect(db.records()[0].values.starts_at).toBe("2026-09-01T05:30:00.000Z");
    expect(db.audits()).toHaveLength(1);
  });
});

describe("domain normalization", () => {
  it("normalizes member status and Korean dates while retaining only phone suffix", () => {
    expect(normalizeMember({ external_member_id: " M1 ", name: " 민수 ", status: "진행중", birth_date: "1990년 2월 3일", phone_last4: "010-1234-5678", total_paid_amount: "₩1,200,000" })).toMatchObject({ values: { external_member_id: "M1", name: "민수", status: "active", birth_date: "1990-02-03", phone_last4: "5678", total_paid_amount: 1200000 }, issues: [] });
  });
  it("normalizes registration money and categories without accepting malformed numbers", () => {
    expect(normalizeRegistration({ name: "민수", registration_date: "2026. 9. 1.", paid_amount: "600,000원", registration_type: "재등록" })).toMatchObject({ values: { registration_date: "2026-09-01", paid_amount: 600000, registration_type: "renewal" }, issues: [] });
    expect(normalizeRegistration({ name: "민수", registration_date: "2026-09-01", paid_amount: "60,00" }).issues).toContainEqual(expect.objectContaining({ field: "paid_amount", code: "invalid_number" }));
  });
  it("preserves field and OT as separate PT sale categories", () => {
    expect(normalizeRegistration({ name: "민수", registration_date: "2026-09-01", paid_amount: 100000, registration_type: "필드" }).values.registration_type).toBe("field");
    expect(normalizeRegistration({ name: "서연", registration_date: "2026-09-01", paid_amount: 50000, registration_type: "오티" }).values.registration_type).toBe("ot");
  });
  it("keeps an explicitly uncategorized paid sale valid", () => {
    expect(normalizeRegistration({ name: "미분류회원", registration_date: "2026-09-01", paid_amount: 123456, registration_type: "미분류" })).toMatchObject({ values: { registration_type: "uncategorized", paid_amount: 123456 }, issues: [] });
  });
  it("normalizes consultation conversion and rejects ambiguous dates and unknown statuses", () => {
    expect(normalizeLead({ name: "민수", lead_date: "2026/09/01", status: "등록완료", is_registered: "예" })).toMatchObject({ values: { lead_date: "2026-09-01", status: "registered", is_registered: true }, issues: [] });
    expect(normalizeLead({ name: "민수", lead_date: "09/01/26", status: "알수없음" }).issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["lead_date", "status"]));
  });
  it("normalizes local class time in Asia/Seoul and class attendance", () => {
    expect(normalizeClass({ name: "민수", class_date: "2026-09-01", starts_at: "오후 2:30", status: "출석", deducted_sessions: "1" })).toMatchObject({ values: { class_date: "2026-09-01", starts_at: "2026-09-01T05:30:00.000Z", status: "completed", deducted_sessions: 1 }, issues: [] });
  });
  it("hashes canonical identity without delimiter ambiguity and isolates connections and tabs", () => {
    expect(sourceRecordKey("c", "t", "id")).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceRecordKey("c|t", "x", "id")).not.toBe(sourceRecordKey("c", "t|x", "id"));
    expect(sourceRecordKey("c", "t", "id")).not.toBe(sourceRecordKey("c", "u", "id"));
  });

  it("does not leak empty join hints into schema values or flag whitespace-only optional cells", () => {
    const row = normalizeRegistration({ name: "민수", external_member_id: "", trainer_name: " ", registration_date: "2026-09-01", paid_amount: 600000, product: " " });
    expect(row.values).not.toHaveProperty("external_member_id");
    expect(row.values).not.toHaveProperty("trainer_name");
    expect(row.issues).toEqual([]);
  });

  it("keeps class business identity stable between equivalent ISO and Korean local times", () => {
    const row = { name: "민수", class_date: "2026-09-01" };
    expect(normalizeClass({ ...row, starts_at: "오후 2:30" }).canonicalIdentity).toBe(normalizeClass({ ...row, starts_at: "2026-09-01T05:30:00Z" }).canonicalIdentity);
  });

  it("accepts ISO timestamp milliseconds", () => {
    const row = { name: "민수", class_date: "2026-09-01" };
    expect(normalizeClass({ ...row, starts_at: "2026-09-01T05:30:00.000Z" }).values.starts_at).toBe("2026-09-01T05:30:00.000Z");
  });
  it("rejects a rollover midnight hour", () => {
    const row = { name: "민수", class_date: "2026-09-01" };
    expect(normalizeClass({ ...row, starts_at: "2026-09-01T24:00:00Z" }).issues).toContainEqual(expect.objectContaining({ field: "starts_at", code: "invalid_time" }));
  });
});
