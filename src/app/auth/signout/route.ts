import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/auth/csrf";
import { appOrigin } from "@/lib/auth/app-url";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { error } = await (await createClient()).auth.signOut({ scope: "local" });
    if (error) throw error;
    return NextResponse.redirect(new URL("/login", appOrigin()), { status: 303, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "로그아웃하지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
