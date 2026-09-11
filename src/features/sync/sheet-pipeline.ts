import { normalizeHeader } from "../mapping/header-normalizer";
import { canonicalFields } from "../mapping/canonical-fields";
import type { MappingDomain } from "../mapping/types";

/** Shared identity/amount/status fields cannot identify a domain on their own. */
export function discoverDomain(title: string, rows: unknown[][]): MappingDomain | null {
  const distinctive: Record<MappingDomain, string[]> = {
    member: ["birth_date", "phone_last4", "remaining_sessions", "total_registered_sessions", "total_paid_amount"],
    registration: ["external_registration_id", "registration_type", "product", "list_amount", "payment_method"],
    lead: ["external_lead_id", "lead_date", "consultation_date", "is_registered", "non_registration_reason"],
    class: ["external_class_id", "class_date", "starts_at", "deducted_sessions"],
  };
  const headers = new Set(rows.slice(0, 50).flat().filter((cell) => typeof cell === "string").map((cell) => normalizeHeader(String(cell))));
  const scores = (Object.keys(distinctive) as MappingDomain[]).map((domain) => {
    let score = canonicalFields[domain].filter((field) => distinctive[domain].includes(field.id) && [field.id, field.label, ...field.synonyms].some((alias) => headers.has(normalizeHeader(alias)))).length * 2;
    const titles = { member: /회원|member/i, registration: /등록|결제|매출|registration/i, lead: /상담|문의|lead/i, class: /수업|출석|시간표|class/i };
    if (titles[domain].test(title)) score++;
    return { domain, score };
  }).sort((a, b) => b.score - a.score);
  return scores[0].score > 0 && scores[0].score > scores[1].score ? scores[0].domain : null;
}

function exactField(domain: MappingDomain, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = normalizeHeader(value);
  return canonicalFields[domain].find((field) => [field.id, field.label, ...field.synonyms].some((alias) => normalizeHeader(alias) === key))?.id ?? null;
}

function monthDay(value: unknown, year: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const full = text.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const match = text.match(/^(\d{1,2})(?:월|\/)\s*(\d{1,2})(?:일)?$/);
  return match ? `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : null;
}

/**
 * Some operational workbooks place the same table more than once on a row
 * (for example PT and FC sales). Convert those repeated blocks into one
 * ordinary table before mapping so every block is ingested without treating
 * dashboard summary cells as records.
 */
export function extractRepeatedTables(rows: unknown[][], domain: MappingDomain, tabTitle = ""): unknown[][] {
  if (domain === "registration" && /^\d{2,4}\.\d{1,2}$/.test(tabTitle)) {
    const headerIndex = rows.findIndex((row, rowIndex) => {
      const names = row.filter((cell) => exactField("registration", cell) === "name").length;
      const marked = rows.slice(0, rowIndex + 1).some((candidate) => candidate.some((cell) => /^(?:PT|FC)(?:\s*매출)?$/i.test(String(cell ?? "").trim())));
      return names > 0 && (marked || (names === 1 && row.some((cell) => exactField("registration", cell) === "payment_method") && row.some((cell) => exactField("registration", cell) === "registration_type")));
    });
    if (headerIndex >= 0) {
      const header = rows[headerIndex], month = tabTitle.split(".");
      const year = Number(month[0]) < 100 ? 2000 + Number(month[0]) : Number(month[0]);
      const markerRows = rows.slice(0, headerIndex + 1);
      const detectedMarkers = markerRows.flatMap((row) => row.flatMap((cell, index) => {
        const match = String(cell ?? "").trim().match(/^(PT|FC)(?:\s*매출)?$/i);
        return match ? [{ kind: match[1].toUpperCase(), start: index }] : [];
      }));
      const nameAnchors = header.flatMap((cell, index) => exactField("registration", cell) === "name" ? [index] : []);
      const ptEntryBlocks = nameAnchors.length >= 2 && nameAnchors.every((start, index) => {
        const end = nameAnchors[index + 1] ?? header.length;
        return header.slice(start, end).some((cell) => ["trainer_name", "acquisition_source"].includes(exactField("registration", cell) ?? ""));
      });
      const headerMarkers = header.flatMap((cell, index) => {
        const match = String(cell ?? "").trim().match(/^(PT|FC)(?:\s*매출)?$/i);
        return match ? [{ kind: match[1].toUpperCase(), start: index }] : [];
      });
      const adjacentMarkers = (rows[headerIndex - 1] ?? []).flatMap((cell, index) => {
        const match = String(cell ?? "").trim().match(/^(PT|FC)(?:\s*매출)?$/i);
        return match ? [{ kind: match[1].toUpperCase(), start: index }] : [];
      });
      const explicitMarkers = headerMarkers.length ? headerMarkers : adjacentMarkers;
      let markers = explicitMarkers.length
        ? explicitMarkers
        : ptEntryBlocks
          ? nameAnchors.map((start) => ({ kind: "PT", start }))
          : [...new Map(detectedMarkers.map((marker) => [marker.start, marker])).values()].sort((a, b) => a.start - b.start);
      const markersShareHeader = explicitMarkers.length > 0;
      if (!markersShareHeader && markers.length >= 2 && nameAnchors.length >= markers.length) {
        markers = markers.map((marker, index) => ({ ...marker, start: nameAnchors[index] }));
      }
      if (!markers.length) markers.push({ kind: header.some((cell) => exactField("registration", cell) === "trainer_name") ? "PT" : "FC", start: 0 });
      const includeAcquisition = header.some((cell) => exactField("registration", cell) === "acquisition_source");
      const output: unknown[][] = [["회원명", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "판매트레이너", ...(includeAcquisition ? ["유입경로"] : []), "결제방법", "상품", "결제상태"]];
      const fcHeaderIndex = rows.findIndex((row, index) => index > headerIndex && row.some((cell) => /^FC$/i.test(String(cell ?? "").trim())) && row.some((cell) => exactField("registration", cell) === "name"));
      const entryRows = rows.slice(headerIndex + 1, fcHeaderIndex >= 0 ? fcHeaderIndex : undefined);
      for (let sectionIndex = 0; sectionIndex < markers.length; sectionIndex++) {
        const marker = markers[sectionIndex];
        const end = markers[sectionIndex + 1]?.start ?? header.length;
        const sectionTrainer = marker.kind === "PT"
          ? markerRows
              .flatMap((row) => row.slice(marker.start, end))
              .map((cell) => String(cell ?? "").trim())
              .findLast((text) =>
                /^[가-힣]{2,6}$/.test(text) &&
                exactField("registration", text) === null &&
                !/^(?:날짜|담당자(?:\s*배정)?|회원명|구분|유입경로|결제방법|매출)$/.test(text),
              )
          : undefined;
        const locate = (field: string) => header.findIndex((cell, index) => index >= marker.start && index < end && exactField("registration", cell) === field);
        const name = locate("name");
        if (name < 0) continue;
        const payment = locate("payment_method");
        const type = locate("registration_type");
        const acquisition = locate("acquisition_source");
        const trainer = locate("trainer_name");
        const salesTrainer = locate("sales_trainer_name");
        const sessions = locate("registered_sessions");
        const mappedAmount = locate("paid_amount");
        const amount = mappedAmount >= 0 ? mappedAmount : payment > marker.start ? payment - 1 : -1;
        const sectionHasOwnDates = entryRows.some((row) => row.slice(marker.start, end).some((cell) => monthDay(cell, year)));
        let currentDate = "";
        let blockTrainer = sectionTrainer ?? "";
        for (const row of entryRows) {
          const leadingTrainer = String(row[marker.start - 1] ?? "").trim();
          if (marker.kind === "PT" && /^[가-힣]{2,6}$/.test(leadingTrainer) && exactField("registration", leadingTrainer) === null) {
            blockTrainer = leadingTrainer;
          }
          const sectionDate = row.slice(marker.start, end).find((cell) => monthDay(cell, year));
          const rawDate = sectionDate ?? (!sectionHasOwnDates ? row.find((cell) => monthDay(cell, year)) : undefined);
          currentDate = monthDay(rawDate, year) ?? currentDate;
          const member = row[name], paid = amount >= 0 ? row[amount] : null;
          if (!currentDate || typeof member !== "string" || !member.trim() || paid == null || !String(paid).trim()) continue;
          const plan = marker.kind === "PT"
            ? `${String(sessions >= 0 ? row[sessions] ?? "" : "").trim() || "회원권"}${sessions >= 0 && String(row[sessions] ?? "").trim() && !/회$/.test(String(row[sessions])) ? "회" : ""}`
            : exactField("registration", header[name + 1]) === "registration_date" ? "회원권" : String(row[name + 1] ?? "").trim() || "회원권";
          const assignedTrainer = trainer >= 0 && String(row[trainer] ?? "").trim()
            ? row[trainer]
            : blockTrainer;
          output.push([member, currentDate, paid, type >= 0 ? row[type] ?? "" : "", assignedTrainer, salesTrainer >= 0 ? row[salesTrainer] ?? "" : "", ...(includeAcquisition ? [acquisition >= 0 ? row[acquisition] ?? "" : ""] : []), payment >= 0 ? row[payment] ?? "" : "", `${marker.kind} ${plan}`, "결제완료"]);
        }
      }
      if (fcHeaderIndex >= 0) {
        const fcHeader = rows[fcHeaderIndex];
        const locateFc = (field: string) => fcHeader.findIndex((cell) => exactField("registration", cell) === field);
        const fcName = locateFc("name");
        const fcDate = Math.max(locateFc("registration_date"), fcHeader.findIndex((cell) => /^날짜$/.test(String(cell ?? "").trim())));
        const fcAmount = Math.max(locateFc("paid_amount"), fcHeader.findIndex((cell) => /^금액$/.test(String(cell ?? "").trim())));
        const fcType = locateFc("registration_type");
        const fcPayment = locateFc("payment_method");
        let currentDate = "";
        for (const row of rows.slice(fcHeaderIndex + 1)) {
          currentDate = monthDay(row[fcDate], year) ?? currentDate;
          const member = row[fcName], paid = row[fcAmount];
          if (!currentDate || typeof member !== "string" || !member.trim() || paid == null || !String(paid).trim()) continue;
          const plan = String(row[fcName + 1] ?? "").trim() || "회원권";
          output.push([member, currentDate, paid, fcType >= 0 ? row[fcType] ?? "" : "", "", "", ...(includeAcquisition ? [""] : []), fcPayment >= 0 ? row[fcPayment] ?? "" : "", `FC ${plan}`, "결제완료"]);
        }
      }
      if (output.length > 1) return output;
    }
  }
  for (let headerRowIndex = 0; headerRowIndex < Math.min(rows.length, 100); headerRowIndex++) {
    const header = rows[headerRowIndex] ?? [];
    const anchors = header.flatMap((cell, index) => exactField(domain, cell) === "name" ? [index] : []);
    if (anchors.length < 2) continue;
    const blocks = anchors.map((start, index) => {
      const end = anchors[index + 1] ?? header.length;
      const seen = new Set<string>();
      const columns = header.slice(start, end).flatMap((cell, offset) => {
        const field = exactField(domain, cell);
        if (!field || seen.has(field)) return [];
        seen.add(field);
        return [{ sourceHeader: String(cell), field, columnIndex: start + offset }];
      });
      return { start, end, columns };
    }).filter((block) => block.columns.some((column) => column.field === "name") &&
      (domain !== "registration" || block.columns.some((column) => column.field === "registration_date")) &&
      (domain !== "class" || block.columns.some((column) => column.field === "class_date")));
    if (blocks.length < 2) continue;
    const fields = [...new Set(blocks.flatMap((block) => block.columns.map((column) => column.field)))];
    const labels = fields.map((field) => blocks.flatMap((block) => block.columns).find((column) => column.field === field)!.sourceHeader);
    const output: unknown[][] = [labels];
    for (const block of blocks) {
      const byField = new Map(block.columns.map((column) => [column.field, column.columnIndex]));
      for (const row of rows.slice(headerRowIndex + 1)) {
        const values = fields.map((field) => row[byField.get(field) ?? -1]);
        const identity = values[fields.indexOf("name")];
        const requiredDate = domain === "registration" ? values[fields.indexOf("registration_date")] : domain === "class" ? values[fields.indexOf("class_date")] : true;
        if (identity !== null && identity !== undefined && String(identity).trim() && requiredDate !== null && requiredDate !== undefined && String(requiredDate).trim()) output.push(values);
      }
    }
    return output;
  }
  return rows;
}

const nonAppointments = new Set(["식사", "휴무", "회의", "이프", "오티", "청소", "교육"]);

export function extractScheduleGrid(rows: unknown[][], tabTitle: string, spreadsheetTitle: string, today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())): unknown[][] {
  const month = spreadsheetTitle.match(/(?:^|\D)(\d{2,4})[.년\s-]+(\d{1,2})(?:월|\D|$)/);
  const day = tabTitle.trim().match(/^\d{1,2}$/);
  if (!month || !day || !/스케줄|일정|시간표/.test(spreadsheetTitle)) return rows;
  const year = Number(month[1]) < 100 ? 2000 + Number(month[1]) : Number(month[1]);
  const date = `${year}-${String(Number(month[2])).padStart(2, "0")}-${String(Number(day[0])).padStart(2, "0")}`;
  const headerRowIndex = rows.findIndex((row, index) =>
    index < 10 && row.some((cell) => typeof cell === "string" && /^[가-힣]{2,6}$/.test(cell.trim())),
  );
  if (headerRowIndex < 0) return rows;
  const header = rows[headerRowIndex] ?? [];
  const trainers = header.flatMap((cell, columnIndex) => typeof cell === "string" && /^[가-힣]{2,6}$/.test(cell.trim()) ? [{ name: cell.trim(), columnIndex }] : []);
  if (!trainers.length) return rows;
  const output: unknown[][] = [["회원명", "수업일", "수업시작시간", "담당트레이너", "잔여횟수", "수업상태", "수업ID"]];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const rawTime = row.slice(0, trainers[0].columnIndex).find((cell) => typeof cell === "string" && /^\d{1,2}:\d{2}$/.test(cell.trim()));
    if (typeof rawTime !== "string") continue;
    const [hour, minute] = rawTime.trim().split(":");
    const time = `${hour.padStart(2, "0")}:${minute}`;
    trainers.forEach((trainer, index) => {
      const end = trainers[index + 1]?.columnIndex ?? row.length;
      for (const cell of row.slice(trainer.columnIndex, end)) {
        if (typeof cell !== "string") continue;
        const match = cell.normalize("NFKC").trim().match(/^([가-힣]{2,6})(?:\s*(\d{1,3})\s*\/\s*(\d{1,3}))?$/);
        if (!match || nonAppointments.has(match[1])) continue;
        const remaining = match[2] && match[3] ? Math.max(0, Number(match[3]) - Number(match[2])) : "";
        output.push([match[1], date, time, trainer.name, remaining, date <= today ? "완료" : "", `schedule|${encodeURIComponent(match[1])}|${date}|${time}|${encodeURIComponent(trainer.name)}`]);
      }
    });
  }
  return output.length > 1 ? output : rows;
}
