import { z } from "zod";
import { canonicalFields } from "@/features/mapping/canonical-fields";
import { normalizeFields } from "@/features/sync/normalize-fields";
const domain = z.enum(["member", "registration", "lead", "class"]);
const uuid = z.string().uuid();
export const reviewCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("correct"), domain, fields: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])) }).strict(),
  z.object({ action: z.enum(["approve", "reject"]), domain }).strict(),
  z.object({ action: z.literal("merge"), retainedId: uuid }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z.object({ action: z.literal("delete_history"), confirmation: z.literal("DELETE HISTORY") }).strict(),
]).superRefine((command, ctx) => {
  if (command.action !== "correct") return;
  const keys = Object.keys(command.fields);
  const allowed = canonicalFields[command.domain].map(f => f.id).filter(f => !["trainer_name", "sales_trainer_name", ...(command.domain === "member" ? [] : ["name", "external_member_id"])].includes(f));
  const normalized = normalizeFields(command.domain, command.fields);
  if (!keys.length || keys.some(k => !allowed.includes(k)) || normalized.issues.some(i => keys.includes(i.field))) ctx.addIssue({ code: "custom", message: "Invalid field correction." });
}).transform(command => command.action === "correct" ? { ...command, fields: normalizeFields(command.domain, command.fields).values } : command);
export const trainerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), email: z.string().trim().email().max(254).toLowerCase(), displayName: z.string().trim().min(1).max(100), active: z.boolean() }).strict(),
  z.object({ action: z.literal("activate"), trainerId: uuid, active: z.boolean() }).strict(),
  z.object({ action: z.literal("assign"), connectionId: uuid, mode: z.enum(["direct", "column"]), trainerId: uuid.optional() }).strict(),
]).superRefine((v, ctx) => { if (v.action === "assign" && (v.mode === "direct" ? !v.trainerId : !!v.trainerId)) ctx.addIssue({ code: "custom", message: "Select a trainer for direct assignment only." }); });
