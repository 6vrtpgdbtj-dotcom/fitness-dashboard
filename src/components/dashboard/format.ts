export const number = (value: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);
export const won = (value: number) => `${number(value)}원`;
export const shortDate = (date: string | null) =>
  date
    ? `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`
    : "기록 없음";
export const percent = (value: number | null) =>
  value === null ? "—" : `${number(value)}%`;
export const statusLabel = (status: string | null) =>
  ({
    paid: "결제 완료",
    pending: "대기",
    refunded: "환불",
    cancelled: "취소",
    new: "신규 문의",
    consulted: "상담 완료",
    registered: "등록 완료",
    not_registered: "미등록",
    scheduled: "예정",
    completed: "완료",
    no_show: "결석",
    active: "진행",
    paused: "휴회",
    ended: "종료",
    inactive: "탈퇴",
    renewal: "재등록",
    additional: "추가 등록",
  })[status ?? ""] ?? "미확인";
