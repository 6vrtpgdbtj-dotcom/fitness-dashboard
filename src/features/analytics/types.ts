export type DateRange = { start: string; end: string };
type RecordScope = {
  id: string;
  trainer_id: string | null;
  record_status: string;
};
export type MemberRow = RecordScope & {
  name: string | null;
  status: string | null;
  remaining_sessions: number | null;
  expected_end_date: string | null;
  latest_registration_date: string | null;
  updated_at: string | null;
};
export type RegistrationRow = RecordScope & {
  member_id: string | null;
  registration_date: string | null;
  registration_type: string | null;
  paid_amount: number | null;
  registered_sessions: number | null;
  acquisition_source: string | null;
  status: string | null;
  product?: string | null;
};
export type LeadRow = RecordScope & {
  member_id: string | null;
  lead_date: string | null;
  consultation_date: string | null;
  status: string | null;
  is_registered: boolean | null;
  acquisition_source: string | null;
};
export type ClassRow = RecordScope & {
  member_id: string | null;
  class_date: string | null;
  starts_at: string | null;
  status: string | null;
  deducted_sessions: number | null;
  remaining_sessions: number | null;
};
export type TrainerRow = { id: string; display_name: string };
export type ConnectionHealth = {
  id: string;
  display_name: string;
  status: string;
  last_successful_sync_at: string | null;
};
export type AnalyticsRows = {
  members: MemberRow[];
  registrations: RegistrationRow[];
  leads: LeadRow[];
  classes: ClassRow[];
  trainers: TrainerRow[];
  connections: ConnectionHealth[];
};
export type RevenuePoint = {
  month: string;
  newRevenue: number;
  renewedRevenue: number;
  additionalRevenue: number;
  refunds: number;
};
export type MemberSummary = {
  id: string;
  name: string;
  trainerId: string | null;
  trainerName: string;
  status: string | null;
  remainingSessions: number | null;
  expectedDepletionDate: string | null;
  estimateBasis: "source" | "pace" | null;
  lastClassDate: string | null;
};
export type SourceConversion = {
  source: string;
  consulted: number;
  converted: number;
  conversionRate: number | null;
};
export type DashboardData = {
  role: "admin" | "trainer";
  period: DateRange;
  today: string;
  rows: AnalyticsRows;
  metrics: {
    periodRevenue: number;
    fcRevenue: number;
    totalRevenue: number;
    refunds: number;
    newRegistrations: number;
    renewedRegistrations: number;
    conversionRate: number | null;
    averagePayment: number | null;
    averageSessions: number | null;
    completedClasses: number;
    assignedMembers: number;
    remainingSessions: {
      total: number | null;
      knownSubtotal: number;
      knownMembers: number;
      unknownMembers: number;
    };
  };
  revenue: RevenuePoint[];
  funnel: { leads: number; consulted: number; converted: number };
  sources: SourceConversion[];
  members: MemberSummary[];
  renewals: MemberSummary[];
  todayClasses: ClassRow[];
  trainerComparison: {
    id: string;
    name: string;
    revenue: number;
    newRevenue: number;
    renewedRevenue: number;
    additionalRevenue: number;
    newRegistrations: number;
    renewedRegistrations: number;
    classes: number;
    members: number;
  }[];
  connections: ConnectionHealth[];
  realtimeTopic: string | null;
};
