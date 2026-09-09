import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function adminMutation(name: "admin_review" | "admin_trainer", args: Record<string, unknown>) {
  try {
    const { data, error } = await (await createClient()).rpc(name, args);
    if (error) return NextResponse.json({ error: "변경하지 못했습니다. 대상·권한·현재 상태를 확인하고 다시 시도해 주세요." }, { status: 409 });
    return NextResponse.json({ result: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "저장 연결을 확인하고 다시 시도해 주세요." }, { status: 503 }); }
}
