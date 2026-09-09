import type { DashboardData } from "@/features/analytics/types";
import { number, shortDate, statusLabel, won } from "./format";
export type DetailKind = "members" | "registrations" | "leads" | "classes";
export const detailTitles: Record<DetailKind, string> = {
  members: "회원 관리",
  registrations: "등록·매출",
  leads: "상담 리드",
  classes: "수업 현황",
};

export function DetailView({
  data,
  kind,
}: {
  data: DashboardData;
  kind: DetailKind;
}) {
  const member = (id: string | null) =>
    data.members.find((row) => row.id === id)?.name ?? "회원 연결 미확인";
  const trainer = (id: string | null) =>
    data.rows.trainers.find((row) => row.id === id)?.display_name ??
    "담당 미지정";
  const inPeriod = (date: string | null) =>
    date !== null && date >= data.period.start && date <= data.period.end;
  const headings =
    kind === "members"
      ? ["회원", "담당", "잔여", "예상 종료", "상태"]
      : kind === "registrations"
        ? ["등록일", "회원", "담당", "유형", "결제 금액", "등록 세션", "상태"]
        : kind === "leads"
          ? ["문의일", "회원", "담당", "상담일", "유입 경로", "상태"]
          : ["수업일", "시간", "회원", "담당", "차감", "잔여", "상태"];
  const rows =
    kind === "members"
      ? data.members.map((row) => ({
          id: row.id,
          cells: [
            row.name,
            row.trainerName,
            row.remainingSessions === null
              ? "미확인"
              : `${number(row.remainingSessions)}회`,
            `${shortDate(row.expectedDepletionDate)}${row.estimateBasis === "pace" ? " (추정)" : ""}`,
            statusLabel(row.status),
          ],
        }))
      : kind === "registrations"
        ? data.rows.registrations
            .filter((row) => inPeriod(row.registration_date))
            .sort((a, b) =>
              (b.registration_date ?? "").localeCompare(
                a.registration_date ?? "",
              ),
            )
            .map((row) => ({
              id: row.id,
              cells: [
                shortDate(row.registration_date),
                member(row.member_id),
                trainer(row.trainer_id),
                row.registration_type === "new"
                  ? "신규"
                  : statusLabel(row.registration_type),
                row.paid_amount === null ? "미확인" : won(row.paid_amount),
                row.registered_sessions === null
                  ? "미확인"
                  : `${number(row.registered_sessions)}회`,
                statusLabel(row.status),
              ],
            }))
        : kind === "leads"
          ? data.rows.leads
              .filter(
                (row) =>
                  inPeriod(row.lead_date) || inPeriod(row.consultation_date),
              )
              .map((row) => ({
                id: row.id,
                cells: [
                  shortDate(row.lead_date),
                  member(row.member_id),
                  trainer(row.trainer_id),
                  shortDate(row.consultation_date),
                  row.acquisition_source ?? "미확인",
                  statusLabel(row.status),
                ],
              }))
          : data.rows.classes
              .filter((row) => inPeriod(row.class_date))
              .sort((a, b) =>
                (b.class_date ?? "").localeCompare(a.class_date ?? ""),
              )
              .map((row) => ({
                id: row.id,
                cells: [
                  shortDate(row.class_date),
                  row.starts_at
                    ? new Intl.DateTimeFormat("ko-KR", {
                        timeZone: "Asia/Seoul",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }).format(new Date(row.starts_at))
                    : "미정",
                  member(row.member_id),
                  trainer(row.trainer_id),
                  row.deducted_sessions === null
                    ? "미확인"
                    : `${number(row.deducted_sessions)}회`,
                  row.remaining_sessions === null
                    ? "미확인"
                    : `${number(row.remaining_sessions)}회`,
                  statusLabel(row.status),
                ],
              }));
  return (
    <section className="detail-page">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{kind.toUpperCase()} / VERIFIED RECORDS</p>
          <h2>
            {detailTitles[kind]}{" "}
            <span className="inline-count">{rows.length}</span>
          </h2>
        </div>
        <a className="text-button" href="/dashboard">
          통합 현황 ↗
        </a>
      </div>
      <p className="panel-note">
        {kind === "members"
          ? "현재 담당 범위의 유효한 회원 기록입니다."
          : `${data.period.start} – ${data.period.end} · 유효한 기록만 표시합니다.`}{" "}
        원본 수정은 Google 시트에서 진행하세요.
      </p>
      {rows.length ? (
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label="상세 기록 표, 작은 화면에서 좌우 스크롤"
        >
          <table className="data-table">
            <caption className="sr-only">
              {detailTitles[kind]} 상세 기록
            </caption>
            <thead>
              <tr>
                {headings.map((heading) => (
                  <th scope="col" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) =>
                    index === 0 ? (
                      <th scope="row" key={index}>
                        {cell}
                      </th>
                    ) : (
                      <td key={index}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-inline">
          표시할 {detailTitles[kind]} 기록이 없습니다.{" "}
          {kind === "members"
            ? "시트 동기화와 담당 범위를 확인하세요."
            : "시트 동기화와 조회 기간을 확인하세요."}
        </div>
      )}
    </section>
  );
}
