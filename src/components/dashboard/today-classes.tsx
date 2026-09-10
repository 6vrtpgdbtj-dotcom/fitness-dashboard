import { ArrowUpRight, Clock3 } from "lucide-react";
import type { ClassRow, MemberSummary } from "@/features/analytics/types";

export function TodayClasses({
  classes,
  members,
  today,
}: {
  classes: ClassRow[];
  members: MemberSummary[];
  today: string;
}) {
  return (
    <div className="today-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">TODAY / {today.replaceAll("-", ".")}</p>
          <h2>
            오늘의 수업 <span className="inline-count">{classes.length}</span>
          </h2>
        </div>
        <a href="/classes" className="text-button" aria-label="수업 전체 보기">
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      {classes.length ? (
        <ol className="today-list">
          {classes.slice(0, 4).map((item) => (
            <li key={item.id}>
              <time dateTime={item.starts_at ?? today}>
                {item.starts_at
                  ? new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(item.starts_at))
                  : "시간 미정"}
              </time>
              <span>
                {members.find((member) => member.id === item.member_id)?.name ??
                  (item.external_class_id?.startsWith("schedule|") ? decodeURIComponent(item.external_class_id.split("|")[1]) : "회원 연결 미확인")}
                <small>
                  {members.find((member) => member.id === item.member_id)
                    ?.trainerName ?? "담당 미확인"}
                </small>
              </span>
              <span
                className={
                  item.status === "completed" ? "class-done" : "class-scheduled"
                }
              >
                {item.status === "completed" ? "완료" : "예정"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="today-empty">
          <Clock3 size={22} aria-hidden="true" />
          <p>
            오늘 표시할 수업이 없습니다.
            <br />
            <span>동기화된 예정·완료 수업이 여기에 표시됩니다.</span>
          </p>
        </div>
      )}
      {classes.length > 4 && (
        <a href="/classes" className="text-button">
          외 {classes.length - 4}개 수업 보기 ↗
        </a>
      )}
    </div>
  );
}
