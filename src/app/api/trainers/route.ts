import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { trainerCommand } from "@/features/admin/commands";
import { adminMutation } from "@/features/admin/http";
export async function POST(request: Request) {
  if ((await requireUser()).role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const command = trainerCommand.safeParse(await request.json().catch(() => null));
  if (!command.success) return NextResponse.json({ error: "이메일·이름·담당 트레이너를 확인해 주세요." }, { status: 400 });
  return adminMutation("admin_trainer", { p_command: command.data });
}
