import { appOrigin } from "./app-url";

// Cookie-authenticated JSON mutations must come from the configured app origin.
// Neither Host nor forwarded headers are a trust anchor for this check.
export function rejectCrossOrigin(request: Request): Response | null {
  try {
    if (request.headers.get("origin") === appOrigin() && request.headers.get("sec-fetch-site") !== "cross-site") return null;
  } catch { /* Missing canonical configuration fails closed. */ }
  return Response.json({ error: "요청 출처를 확인할 수 없습니다. 페이지를 새로고침해 주세요." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
