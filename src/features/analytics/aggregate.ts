import type { UserScope } from "@/lib/auth/user-scope";
import type {
  AnalyticsRows,
  DashboardData,
  DateRange,
  MemberSummary,
  RevenuePoint,
} from "./types";

const dayMs = 86400000;
const koreaDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const koreaToday = () => koreaDate(new Date());
export function parsePeriod(start: unknown, end: unknown): DateRange | null {
  const valid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    !valid(start) ||
    !valid(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 366 * dayMs
  )
    return null;
  return { start, end };
}
export function currentMonth(today = koreaToday()): DateRange {
  const date = new Date(`${today}T00:00:00Z`);
  return {
    start: `${today.slice(0, 7)}-01`,
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10),
  };
}
const within = (date: string | null, period: DateRange) =>
  date !== null && date >= period.start && date <= period.end;
const sum = <T>(rows: T[], value: (row: T) => number | null) =>
  rows.reduce((total, row) => total + Number(value(row) ?? 0), 0);
const average = <T>(rows: T[], value: (row: T) => number | null) => {
  const known = rows.filter((row) => value(row) !== null);
  return known.length ? sum(known, value) / known.length : null;
};
const dominant = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  values.filter((value): value is string => !!value).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] ?? "미확인";
};
const sessionBucket = (sessions: number | null) => sessions === null ? null : sessions <= 10 ? "1–10회" : sessions <= 20 ? "11–20회" : sessions <= 30 ? "21–30회" : sessions <= 40 ? "31–40회" : sessions <= 50 ? "41–50회" : "51회 이상";
const ageBucket = (birth: string | null | undefined, today: string) => {
  if (!birth) return null; const age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  return age < 20 ? "10대 이하" : age < 30 ? "20대" : age < 40 ? "30대" : age < 50 ? "40대" : age < 60 ? "50대" : "60대 이상";
};
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);

/** Receives rows already protected by database RLS; repeats trainer filtering as defense in depth.
 * Dates are inclusive Korean calendar dates. Revenue is gross paid, refunds separate.
 * Renewal pace uses completed deducted sessions over the trailing 28 days, not a forecast claim. */
export function buildDashboardData(
  input: AnalyticsRows,
  scope: UserScope,
  period: DateRange,
  today = koreaToday(),
): DashboardData {
  if (scope.role === "trainer" && !scope.trainerId)
    throw new Error("trainer_scope_required");
  if (!parsePeriod(period.start, period.end)) throw new Error("invalid_period");
  const permitted = <
    T extends { trainer_id: string | null; record_status: string },
  >(
    items: T[],
  ) =>
    items.filter(
      (row) =>
        row.record_status === "valid" &&
        (scope.role === "admin" || row.trainer_id === scope.trainerId),
    );
  const classMap = new Map<string, AnalyticsRows["classes"][number]>();
  for (const row of permitted(input.classes)) {
    const key = `${row.trainer_id ?? ""}:${row.class_date ?? ""}:${row.starts_at ?? ""}`;
    const previous = classMap.get(key);
    if (!previous || (!previous.external_class_id?.startsWith("schedule|") && row.external_class_id?.startsWith("schedule|"))) classMap.set(key, row);
  }
  const rows: AnalyticsRows = {
    members: permitted(input.members),
    registrations: permitted(input.registrations),
    leads: permitted(input.leads),
    classes: [...classMap.values()],
    trainers: input.trainers.filter(
      (row) => scope.role === "admin" || row.id === scope.trainerId,
    ),
    connections: scope.role === "admin" ? input.connections : [],
  };
  const registrations = rows.registrations.filter((row) =>
    within(row.registration_date, period),
  );
  const paid = registrations.filter((row) => row.status === "paid");
  const fcPaid = paid.filter((row) => row.product?.startsWith("FC "));
  const ptPaid = paid.filter((row) => !row.product?.startsWith("FC "));
  const refunded = registrations.filter((row) => row.status === "refunded");
  const consultations = rows.leads.filter(
    (row) =>
      within(row.consultation_date, period) &&
      ["consulted", "registered", "not_registered"].includes(row.status ?? ""),
  );
  const converted = consultations.filter(
    (row) => row.is_registered === true || row.status === "registered",
  );
  const completedClasses = rows.classes.filter(
    (row) => row.status === "completed" && within(row.class_date, period),
  );
  const trainerName = (id: string | null) =>
    rows.trainers.find((row) => row.id === id)?.display_name ?? "담당 미지정";
  const members: MemberSummary[] = rows.members.map((member) => {
    const completed = rows.classes
      .filter(
        (row) =>
          row.member_id === member.id &&
          row.status === "completed" &&
          row.class_date &&
          row.class_date <= today,
      )
      .sort(
        (a, b) =>
          (b.class_date ?? "").localeCompare(a.class_date ?? "") ||
          (b.starts_at ?? "").localeCompare(a.starts_at ?? ""),
      );
    const balanceClass = completed.find(
      (row) => row.remaining_sessions !== null,
    );
    // A class balance is a historical snapshot, not the current inventory. A
    // registration on/after that date invalidates it (date-only ties are unknown).
    // Do not use a class's import/update time: re-syncing history is not a new class.
    const paidRegistrationDates = rows.registrations
      .filter((row) => row.member_id === member.id && row.status === "paid")
      .map((row) => row.registration_date)
      .filter((date): date is string => date !== null && date <= today)
      .sort();
    const registrationDates = [
      member.latest_registration_date,
      ...paidRegistrationDates,
    ];
    const registrationSinceClass =
      balanceClass &&
      registrationDates.some(
        (date) =>
          date !== null && date <= today && date >= balanceClass.class_date!,
      );
    const currentSnapshotTime = Date.parse(member.updated_at ?? "");
    const currentSnapshotDate = Number.isFinite(currentSnapshotTime)
      ? koreaDate(new Date(currentSnapshotTime))
      : null;
    const latestPaidRegistration = paidRegistrationDates.at(-1);
    // Separate sheets can sync at different times. If a paid renewal is newer
    // than this member snapshot and the member row does not yet acknowledge it,
    // neither its old balance nor its old end date is current evidence.
    const currentPredatesRegistration =
      latestPaidRegistration &&
      currentSnapshotDate &&
      currentSnapshotDate < latestPaidRegistration &&
      (member.latest_registration_date ?? "") < latestPaidRegistration;
    const currentRemaining = currentPredatesRegistration
      ? null
      : member.remaining_sessions;
    const sourceExpectedEnd = currentPredatesRegistration
      ? null
      : member.expected_end_date;
    const classEventTime = balanceClass
      ? Date.parse(
          balanceClass.starts_at ?? `${balanceClass.class_date}T00:00:00+09:00`,
        )
      : NaN;
    // A known current balance wins unless the class is demonstrably newer.
    // With no class time, compare against the start of its Korean calendar day;
    // with no current snapshot time, retain the known current value.
    const classIsNewer =
      Number.isFinite(currentSnapshotTime) &&
      classEventTime > currentSnapshotTime;
    const remaining =
      balanceClass &&
      !registrationSinceClass &&
      (currentRemaining === null || classIsNewer)
        ? balanceClass.remaining_sessions
        : currentRemaining;
    const consumption = sum(
      completed.filter((row) =>
        within(row.class_date, { start: addDays(today, -27), end: today }),
      ),
      (row) => row.deducted_sessions,
    );
    const estimated =
      remaining !== null && consumption > 0
        ? addDays(
            today,
            Math.ceil(Math.max(0, Number(remaining)) / (consumption / 28)),
          )
        : null;
    return {
      id: member.id,
      name: member.name ?? "이름 미확인",
      trainerId: member.trainer_id,
      trainerName: trainerName(member.trainer_id),
      status: member.status,
      remainingSessions: remaining === null ? null : Number(remaining),
      expectedDepletionDate: sourceExpectedEnd ?? estimated,
      estimateBasis: sourceExpectedEnd ? "source" : estimated ? "pace" : null,
      lastClassDate: completed[0]?.class_date ?? null,
    };
  });
  const activeMembers = members.filter(
    (member) => member.status !== "ended" && member.status !== "inactive",
  );
  const uniqueMemberCount = (items: MemberSummary[]) => new Set(items.map((member) => `${member.trainerId ?? "unassigned"}:${member.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`)).size;
  const knownBalances = activeMembers.filter(
    (member) => member.remainingSessions !== null,
  );
  const knownSubtotal = sum(
    knownBalances,
    (member) => member.remainingSessions,
  );
  const unknownMembers = activeMembers.length - knownBalances.length;
  const revenue: RevenuePoint[] = [];
  for (
    let month = period.start.slice(0, 7);
    month <= period.end.slice(0, 7);

  ) {
    const current = paid.filter((row) =>
      row.registration_date?.startsWith(month),
    );
    revenue.push({
      month,
      newRevenue: sum(
        current.filter((row) => row.registration_type === "new"),
        (row) => row.paid_amount,
      ),
      renewedRevenue: sum(
        current.filter((row) => row.registration_type === "renewal"),
        (row) => row.paid_amount,
      ),
      additionalRevenue: sum(
        current.filter(
          (row) => !["new", "renewal"].includes(row.registration_type ?? ""),
        ),
        (row) => row.paid_amount,
      ),
      refunds: sum(
        refunded.filter((row) => row.registration_date?.startsWith(month)),
        (row) => row.paid_amount,
      ),
    });
    const date = new Date(`${month}-01T00:00:00Z`);
    month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 7);
  }
  return {
    role: scope.role,
    period,
    today,
    rows,
    realtimeTopic: null,
    metrics: {
      periodRevenue: sum(ptPaid, (row) => row.paid_amount),
      fcRevenue: sum(fcPaid, (row) => row.paid_amount),
      totalRevenue: sum(
        rows.registrations.filter((row) => row.status === "paid"),
        (row) => row.paid_amount,
      ),
      refunds: sum(refunded, (row) => row.paid_amount),
      newRegistrations: paid.filter((row) => row.registration_type === "new")
        .length,
      renewedRegistrations: paid.filter(
        (row) => row.registration_type === "renewal",
      ).length,
      conversionRate: consultations.length
        ? (100 * converted.length) / consultations.length
        : null,
      averagePayment: average(paid, (row) => row.paid_amount),
      averageSessions: average(paid, (row) => row.registered_sessions),
      completedClasses: completedClasses.length,
      assignedMembers: uniqueMemberCount(activeMembers),
      remainingSessions: {
        total: unknownMembers ? null : knownSubtotal,
        knownSubtotal,
        knownMembers: knownBalances.length,
        unknownMembers,
      },
    },
    revenue,
    funnel: {
      leads: rows.leads.filter((row) => within(row.lead_date, period)).length,
      consulted: consultations.length,
      converted: converted.length,
    },
    sources: [
      ...new Set(
        consultations.map((row) => row.acquisition_source ?? "경로 미확인"),
      ),
    ].map((source) => {
      const count = consultations.filter(
        (row) => (row.acquisition_source ?? "경로 미확인") === source,
      ).length;
      const registrations = converted.filter(
        (row) => (row.acquisition_source ?? "경로 미확인") === source,
      ).length;
      return {
        source,
        consulted: count,
        converted: registrations,
        conversionRate: count ? (100 * registrations) / count : null,
      };
    }),
    members,
    renewals: activeMembers
      .filter(
        (row) =>
          (row.remainingSessions !== null && row.remainingSessions <= 5) ||
          (row.expectedDepletionDate !== null &&
            row.expectedDepletionDate <= addDays(today, 14)),
      )
      .sort(
        (a, b) =>
          (a.remainingSessions ?? Infinity) - (b.remainingSessions ?? Infinity),
      ),
    todayClasses: rows.classes
      .filter(
        (row) =>
          row.class_date === today &&
          ["scheduled", "completed"].includes(row.status ?? ""),
      )
      .sort((a, b) => (a.starts_at ?? "z").localeCompare(b.starts_at ?? "z")),
    trainerComparison:
      scope.role === "admin"
        ? rows.trainers.map((trainer) => ({
            id: trainer.id,
            name: trainer.display_name,
            revenue: sum(
              ptPaid.filter((row) => row.trainer_id === trainer.id),
              (row) => row.paid_amount,
            ),
            newRevenue: sum(ptPaid.filter((row) => row.trainer_id === trainer.id && row.registration_type === "new"), (row) => row.paid_amount),
            renewedRevenue: sum(ptPaid.filter((row) => row.trainer_id === trainer.id && row.registration_type === "renewal"), (row) => row.paid_amount),
            additionalRevenue: sum(ptPaid.filter((row) => row.trainer_id === trainer.id && !["new", "renewal"].includes(row.registration_type ?? "")), (row) => row.paid_amount),
            strongestSessionBucket: dominant(ptPaid.filter((row) => row.trainer_id === trainer.id).map((row) => sessionBucket(row.registered_sessions))),
            strongestGoal: dominant(rows.members.filter((row) => row.trainer_id === trainer.id).map((row) => row.exercise_goal)),
            strongestAgeGroup: dominant(rows.members.filter((row) => row.trainer_id === trainer.id).map((row) => ageBucket(row.birth_date, today))),
            ...(() => {
              const career = rows.registrations.filter((row) => row.status === "paid" && row.trainer_id === trainer.id && !row.product?.startsWith("FC ") && row.registration_date);
              const total = sum(career, (row) => row.paid_amount), first = career.map((row) => row.registration_date!).sort()[0];
              const months = first ? Math.max(1, (Number(today.slice(0,4)) - Number(first.slice(0,4))) * 12 + Number(today.slice(5,7)) - Number(first.slice(5,7)) + 1) : 1;
              const years = first ? Math.max(1, Number(today.slice(0,4)) - Number(first.slice(0,4)) + 1) : 1;
              return { careerRevenue: total, monthlyAverageRevenue: total / months, yearlyAverageRevenue: total / years };
            })(),
            newRegistrations: paid.filter(
              (row) =>
                row.trainer_id === trainer.id &&
                row.registration_type === "new",
            ).length,
            renewedRegistrations: paid.filter(
              (row) =>
                row.trainer_id === trainer.id &&
                row.registration_type === "renewal",
            ).length,
            classes: completedClasses.filter(
              (row) => row.trainer_id === trainer.id,
            ).length,
            members: uniqueMemberCount(activeMembers.filter((row) => row.trainerId === trainer.id)),
          }))
        : [],
    connections: rows.connections,
  };
}
