import { rejectCrossOrigin } from "@/lib/auth/csrf";
import { readUserScope } from "@/lib/auth/user-scope";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
const denied = (status: number) => Response.json({ error: "인증을 확인할 수 없습니다." }, { status, headers });

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const client = await createClient();
    const scope = await readUserScope(client);
    if (scope.error) return denied(scope.error === "unauthenticated" ? 401 : 403);
    // getUser + the active database profile above authorize the request. Only
    // then may getSession supply a token from the server-owned refresh session.
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session || session.user.id !== scope.user.id || !session.access_token ||
      !session.expires_at || session.expires_at <= Date.now() / 1000) return denied(401);
    return Response.json({ accessToken: session.access_token, expiresAt: session.expires_at }, { headers });
  } catch { return denied(503); }
}
