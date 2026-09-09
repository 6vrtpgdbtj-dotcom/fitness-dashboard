import type { MappingDomain, MappingResult } from "@/features/mapping/types";
export type ReviewRecord = { id: string; domain: MappingDomain; tab_title: string; record_status: string; name?: string | null; issues: { field: string; code: string; message: string }[]; source_fields: { sourceHeader: string; field: string | null }[]; [key: string]: unknown };
export type MemberCandidate = { id: string; name: string | null; external_member_id: string | null; source_record_key: string };
export type Trainer = { id: string; display_name: string; email: string; is_active: boolean; claimed: boolean };
export type AdminConnection = { id: string; display_name: string; is_active: boolean; trainer_id: string | null; trainer_assignment_mode: "direct" | "column" };
export type AdminTab = { id: string; source_connection_id: string; title: string; domain: MappingDomain | null; mappingResult: MappingResult };
export type AdminWorkspace = { records: ReviewRecord[]; members: MemberCandidate[]; trainers: Trainer[]; connections: AdminConnection[]; tabs: AdminTab[]; audits: { id: string; created_at: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null }[] };
