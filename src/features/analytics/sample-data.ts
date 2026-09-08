import type { AnalyticsRows } from "./types";

/** Explicit fictional UI fixture. Never imported by authenticated production queries. */
export function sampleRows(): AnalyticsRows {
  const trainers = [
    { id: "sample-a", display_name: "샘플 트레이너 A" },
    { id: "sample-b", display_name: "샘플 트레이너 B" },
    { id: "sample-c", display_name: "샘플 트레이너 C" },
  ];
  const members = Array.from({ length: 9 }, (_, index) => ({
    id: `sample-member-${index}`,
    trainer_id: trainers[index % 3].id,
    record_status: "valid",
    name: `샘플 회원 ${String(index + 1).padStart(2, "0")}`,
    status: "active",
    remaining_sessions: [3, 5, 2, 18, 12, 8, 21, 7, 14][index],
    expected_end_date: index < 3 ? `2026-09-${12 + index * 3}` : null,
  }));
  const registrations = [4, 5, 6, 7, 8, 9].flatMap((month, monthIndex) =>
    trainers.flatMap((trainer, index) =>
      ["new", "renewal"].map((type, typeIndex) => ({
        id: `sample-r-${month}-${index}-${type}`,
        trainer_id: trainer.id,
        record_status: "valid",
        member_id: members[index].id,
        registration_date: `2026-${String(month).padStart(2, "0")}-05`,
        registration_type: type,
        paid_amount:
          [780000, 1050000, 920000, 1280000, 1160000, 1420000][monthIndex] +
          index * 110000 +
          typeIndex * 230000,
        registered_sessions: typeIndex ? 30 : 20,
        acquisition_source: ["소개", "방문", "온라인"][index],
        status: "paid",
      })),
    ),
  );
  const leads = Array.from({ length: 18 }, (_, index) => ({
    id: `sample-lead-${index}`,
    trainer_id: trainers[index % 3].id,
    record_status: "valid",
    member_id: members[index % 9].id,
    lead_date: `2026-09-${String((index % 7) + 1).padStart(2, "0")}`,
    consultation_date: index < 14 ? "2026-09-07" : null,
    status:
      index < 8 ? "registered" : index < 14 ? "not_registered" : "scheduled",
    is_registered: index < 8,
    acquisition_source: ["소개", "방문", "온라인"][index % 3],
  }));
  const classes = members.flatMap((member, index) => [
    {
      id: `sample-c-${index}`,
      trainer_id: member.trainer_id,
      record_status: "valid",
      member_id: member.id,
      class_date: "2026-09-07",
      starts_at: null,
      status: "completed",
      deducted_sessions: 1,
      remaining_sessions: member.remaining_sessions,
    },
    ...(index < 4
      ? [
          {
            id: `sample-today-${index}`,
            trainer_id: member.trainer_id,
            record_status: "valid",
            member_id: member.id,
            class_date: "2026-09-08",
            starts_at: `2026-09-08T${String(index + 1).padStart(2, "0")}:00:00Z`,
            status: index === 0 ? "completed" : "scheduled",
            deducted_sessions: index === 0 ? 1 : null,
            remaining_sessions: member.remaining_sessions,
          },
        ]
      : []),
  ]);
  return {
    members,
    registrations,
    leads,
    classes,
    trainers,
    connections: trainers.map((trainer, index) => ({
      id: `sample-sheet-${index}`,
      display_name: `${trainer.display_name} 운영 시트`,
      status: "succeeded",
      last_successful_sync_at: `2026-09-08T02:1${index}:00Z`,
    })),
  };
}
