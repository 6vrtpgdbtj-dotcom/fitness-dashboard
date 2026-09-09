import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { reviewCommand } from "@/features/admin/commands";
import { adminMutation } from "@/features/admin/http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if ((await requireUser()).role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const id = z.string().uuid().safeParse((await context.params).id);
  const command = reviewCommand.safeParse(await request.json().catch(() => null));
  if (!id.success || !command.success) return NextResponse.json({ error: "입력값과 삭제 확인 문구를 확인해 주세요." }, { status: 400 });
  return adminMutation("admin_review", { p_id: id.data, p_command: command.data });
}
