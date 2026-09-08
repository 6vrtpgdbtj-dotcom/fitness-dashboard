import { ArrowUpRight } from "lucide-react";
import type { MemberSummary } from "@/features/analytics/types";
import { number, shortDate } from "./format";

export function RenewalTable({
  members,
  role,
}: {
  members: MemberSummary[];
  role: "admin" | "trainer";
}) {
  return (
    <div className="renewal-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEXT ACTION</p>
          <h2>
            재등록, 지금 확인할 회원{" "}
            <span className="inline-count">{members.length}</span>
          </h2>
        </div>
        <a className="text-button" href="/members">
          회원 보기 <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
      <p className="panel-note">
        잔여 5회 이하 또는 예상 종료 14일 이내 · 날짜 추정은 최근 28일 소진 속도
        기준
      </p>
      {members.length === 0 ? (
        <p className="empty-inline">현재 재등록 확인 대상이 없습니다.</p>
      ) : (
        <>
          <div className="renewal-desktop table-scroll" tabIndex={0}>
            <table className="data-table">
              <caption className="sr-only">재등록 확인 대상 회원</caption>
              <thead>
                <tr>
                  <th scope="col">회원</th>
                  {role === "admin" && <th scope="col">담당</th>}
                  <th scope="col">잔여 세션</th>
                  <th scope="col">예상 소진일</th>
                  <th scope="col">최근 수업</th>
                  <th scope="col">다음 확인</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">
                      <span className="member-cell">
                        <i aria-hidden="true">{member.name.slice(-1)}</i>
                        {member.name}
                      </span>
                    </th>
                    {role === "admin" && <td>{member.trainerName}</td>}
                    <td>
                      <strong
                        className={
                          member.remainingSessions !== null &&
                          member.remainingSessions <= 3
                            ? "text-warning"
                            : ""
                        }
                      >
                        {member.remainingSessions === null
                          ? "미확인"
                          : `${number(member.remainingSessions)}회`}
                      </strong>
                    </td>
                    <td>
                      {shortDate(member.expectedDepletionDate)}{" "}
                      <small>
                        {member.estimateBasis === "pace"
                          ? "추정"
                          : member.estimateBasis === "source"
                            ? "시트 기준"
                            : ""}
                      </small>
                    </td>
                    <td>{shortDate(member.lastClassDate)}</td>
                    <td className="text-accent">상담 권장 ↗</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="renewal-mobile">
            {members.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {role === "admin"
                      ? member.trainerName
                      : `최근 수업 ${shortDate(member.lastClassDate)}`}
                  </span>
                </div>
                <div>
                  <strong className="text-warning">
                    {member.remainingSessions ?? "—"}
                    <small> 회 남음</small>
                  </strong>
                  <span>
                    {shortDate(member.expectedDepletionDate)}
                    {member.estimateBasis === "pace" ? " 소진 추정" : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
