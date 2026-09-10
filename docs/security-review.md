# Security review — Task 9

## Executive summary

Reviewed the Next.js 15.5.25 / React / TypeScript application, Supabase migrations,
Google OAuth/read/sync boundaries and production dependencies. No confirmed
critical vulnerability was found. Fixed an application-level CSRF gap, missing
Secure/HttpOnly session-cookie enforcement, missing framing/MIME headers, and two high
PostCSS dependency advisories. Known production dependency audit is now clean.

**This is not a production security sign-off.** Refresh sessions are now server-
owned HttpOnly cookies, with an authenticated in-memory access-token handoff for
Realtime. Live migration/renewal acceptance, edge rate/payload limits and strict
script CSP are unverified/unresolved. Real Supabase/Google
login, deployed RLS and HTTPS cookie round trips could not be exercised without
credentials/infrastructure. Three live browser tests explicitly skip and the
manual acceptance procedure is in `docs/browser-qa.md`.

Method: read the installed general frontend, Next.js server and React security
references in full; enumerate all routes/actions, follow auth/tenant data paths,
inspect library cookie defaults, run negative route tests, existing PostgreSQL
PGlite tests, browser response/layout checks and the production dependency audit.
PGlite tests execute actual PostgreSQL logic but are not a hosted Supabase or
PostgREST/Google identity-provider deployment test. Evidence paths below are
repository-relative, with exact one-based lines in the final implementation.

## Critical

No confirmed finding. This is a scoped source/runtime review, not a penetration
test or proof that unknown vulnerabilities do not exist.

## High

### 1. Cookie-authenticated mutations lacked Origin validation — resolved

- Rule: NEXT-CSRF-001 / REACT-CSRF-001.
- Evidence: before this change, `src/app/api/sheets/route.ts` read JSON and called
  Google after role authorization alone. The negative test returned **201** for
  `Origin: https://evil.example`, `Origin: null` and an absent Origin. Final
  `src/lib/auth/csrf.ts:4-10` requires equality with configured `appOrigin()` and
  rejects `Sec-Fetch-Site: cross-site`; `src/app/api/sheets/route.ts:22-23`,
  `src/app/api/trainers/route.ts:7-8`, `src/app/api/review/[id]/route.ts:8-9`,
  `src/app/api/sheets/[id]/sync/route.ts:9-10` call it before side effects.
- Impact: a request that carries an administrator's cookies could previously
  trigger privileged mutations without an application-level origin boundary.
- Fix: fail closed on missing, opaque, foreign or unconfigured Origin; retain
  role/ownership checks and SameSite=Lax. Requests outside the browser must send
  the canonical Origin as well as authenticate.
- Mitigation: trusted HTTPS origin, no credentialed wildcard CORS, edge controls.
- False-positive limits: JSON content type and browser SameSite rules already
  prevent many ordinary cross-site requests. The regression establishes the
  missing server boundary, not a universal cross-site-cookie exploit in every
  browser. Server Actions retain Next's Origin checks; Google webhook/cron use
  explicit non-cookie credentials and are intentionally exempt.
- Verification: `tests/security-boundaries.test.ts` fails before the fix (3/4),
  passes afterward; existing administrator route tests continue to pass.

### 2. Vulnerable PostCSS in production dependency tree — resolved

- Rule: NEXT-SUPPLY-001 / REACT-SUPPLY-001.
- Evidence: baseline `pnpm audit --prod --json` reported `.>next>postcss@8.4.31`,
  two high and two moderate advisories. Final `pnpm-workspace.yaml:4-5` overrides
  PostCSS to `^8.5.23`; `pnpm-lock.yaml:2256` pins **8.5.26**.
- Impact: processing attacker-controlled CSS source-map comments in affected
  PostCSS can read local files; applicability requires an untrusted CSS pipeline.
  [File disclosure advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q),
  [path traversal advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849).
- Fix: patched compatible transitive package and committed lockfile.
- Mitigation: keep CSS build input trusted and run frozen installs/audits in CI.
- False-positive limits: no user CSS upload/compilation feature was found; this
  is a confirmed vulnerable dependency, not demonstrated remote exploitation of
  the running dashboard. Upgrade nonetheless meets the explicit quality gate.
- Verification: final `pnpm audit --prod` reports no known vulnerabilities; full
  production build and browser CSS checks validate compatibility.

## Medium

### 3. Session-cookie Secure/HttpOnly hardening — implementation resolved; live rollout open

- Rule: NEXT-SESS-001 / REACT-AUTH-001.
- Evidence: installed `node_modules/@supabase/ssr/src/utils/constants.ts:5-6`
  defaults to `sameSite: "lax", httpOnly: false` and no Secure attribute.
  Final `src/lib/supabase/cookie-options.ts:3-10` forces HttpOnly on every write
  and Secure in production or configured HTTPS; `src/lib/supabase/server.ts:11,16`, `src/middleware.ts:22,28`
  share the policy. `tests/ssr-cookie-security.test.ts` uses the real installed
  server SDK and cookie adapter, including a token rotation HTTP fixture.
- Impact: without Secure, browser session cookies may travel over HTTP. With
  HttpOnly absent, any future same-origin script compromise can steal the
  Supabase refresh token. No exploitable XSS sink was found in app sources.
- Fix applied: server Auth owns all refresh-session/PKCE cookies (HttpOnly,
  Secure, SameSite=Lax). `src/lib/supabase/client.ts:8-36` uses the supported
  `accessToken` callback, not `createBrowserClient` or browser Auth storage.
  `src/app/api/realtime/token/route.ts:8-21` validates canonical Origin, verifies
  Auth user + active trusted profile, then returns only the existing expiring
  access JWT and expiry; no refresh token, provider token or user payload. All
  responses are no-store. Missing, expired/mismatched sessions fail closed.
  The callback deduplicates concurrent requests, caches at most 20 seconds in
  memory, renews through the SDK heartbeat, and clears stale authorization on
  failures (`client.ts:15-29`). It does not mint an additional long-lived token.
- Library evidence: installed `@supabase/supabase-js` 2.115.0 source
  `node_modules/@supabase/supabase-js/src/SupabaseClient.ts:346-362` disables the
  browser Auth client when `accessToken` is supplied; `:383-397` passes its
  callback to Realtime. Installed realtime-js 2.115.0 source
  `node_modules/.pnpm/@supabase+realtime-js@2.115.0/node_modules/@supabase/realtime-js/src/RealtimeClient.ts:306-307,738-742`
  renews on connection/heartbeat, and `:660-679` updates joined channels. At
  `:635-642` a thrown callback would retain an old token, so our callback returns
  null on failure (the Supabase wrapper then uses the anonymous key, which cannot
  authorize the existing private/RLS-protected topics).
- Mitigation: HTTPS deployment, short access-token lifetimes/refresh rotation,
  strict script CSP and no untrusted HTML rendering.
- False-positive limits: Supabase's default browser-session design was a supported
  integration, not itself proof of an exploit. This Medium item was hardening debt
  against the specified HttpOnly requirement; no exploitable XSS was found.
  HttpOnly prevents reading the refresh cookie, not same-origin XSS from calling
  the handoff endpoint or acting as the user. The access JWT remains necessarily
  visible in browser memory/WebSocket traffic until expiry. Existing private
  topics, server authorization and RLS remain essential. Google provider refresh
  credentials remain encrypted and server-only.
- Verification: initial real-SDK regression observed `httpOnly: false`; initial
  browser-SDK regression used the anonymous key rather than the handoff JWT.
  Both now pass, as do real-SDK refresh rotation, handoff negative tests and
  unchanged Realtime component tests. These are deterministic SDK/route tests,
  **not a real hosted Realtime or Google renewal success claim**.
- Open deployment acceptance: invalidate pre-change refresh sessions, clear old
  browser session storage and require fresh login; changing flags does not
  retroactively protect already-issued cookies/tokens. Re-capture test storage
  states only after HTTPS cookie inspection. Execute initial login, expiry/refresh,
  private-channel update and inactive-profile checks in `docs/browser-qa.md`.
  The implementation meets the cookie requirement locally; operational rollover
  and real-provider renewal remain blocked on external credentials/infrastructure.

### 4. Distributed rate limits and request payload ceilings — deployment gate

- Rule: NEXT-DOS-001 / NEXT-LIMITS-001.
- Evidence: `src/app/login/actions.ts:7-16` starts OAuth; admin handlers such as
  `src/app/api/sheets/route.ts:27` and `src/app/api/trainers/route.ts:10` parse JSON
  without an explicit byte ceiling; `src/features/sync/orchestration.ts:35-48`
  takes a connection lease, and `:109-122` caps reconciliation at four workers.
  No edge configuration establishing rate or body limits exists in this repo.
- Impact: repeated login/API/webhook requests can consume resources or Google
  quota. Leases prevent simultaneous workers, not sustained abuse or large input.
- Fix required: deployed edge body/header/time limits, per-IP login/webhook limits
  and distributed per-actor/tenant mutation quotas. Verify Supabase Auth limits.
- Mitigation: keep app behind an edge/reverse proxy, authenticated mutations and
  bounded Google timeouts/retries; monitor 429/5xx rates with redacted telemetry.
- False-positive limits: hosting/Supabase may already provide limits, but they
  were not configured or observable here. No in-memory limiter is presented as
  protection across serverless instances. Do not expose publicly until verified.

### 5. Strict script CSP is not yet enforced — deployment gate

- Rule: NEXT-CSP-001 / REACT-CSP-001.
- Evidence: `next.config.ts:10` sets `frame-ancestors 'none'; object-src 'none';
  base-uri 'self'` but intentionally contains no `script-src` directive.
- Impact: current policy does not stop script execution if a future XSS bug is
  introduced; it is framing/base/object hardening, not comprehensive XSS control.
- Fix required: a per-request nonce policy compatible with dynamic Next SSR and
  Realtime, verified first in report-only mode on the deployed origin.
- Mitigation: React text escaping, self-hosted fonts/assets, no dangerous HTML
  insertion, remote tags, eval or arbitrary script loading found in app code.
- False-positive limits: absence of script CSP is defense-in-depth debt, not a
  demonstrated XSS vulnerability. Edge policy may supplement it; inspect actual
  production response headers. No unsafe-inline/unsafe-eval exception was added.

## Low

### 6. Missing baseline response headers — resolved

- Rule: NEXT-HEADERS-001 / REACT-HEADERS-001.
- Evidence: runtime `/login` originally returned no X-Frame-Options;
  `next.config.ts:5-10` now applies DENY, nosniff, referrer/permissions policies
  and the limited CSP above to all application routes.
- Impact: framing could assist UI redress; MIME sniffing and unnecessary browser
  capabilities lacked explicit defensive headers.
- Fix: central headers. Mitigation: retain edge equivalents when deploying.
- False-positive limits: previously unknown edge headers could already protect
  hosted deployments. Finding was confirmed on the local app server only.
- Verification: Playwright header test failed before the fix and passed after it.

### 7. OAuth failure paths retained state cookie — resolved

- Rule: NEXT-SESS-002 / OAuth state lifecycle.
- Evidence: baseline callback deleted state only on the success response and
  returned fresh redirects on failure. Final `src/app/api/google/callback/route.ts:12-17`
  centralizes nonce deletion, no-store and canonical-origin redirects; `:23-24`
  refuses a provider denial even when a code is also present.
- Impact: failed consent/exchange leaves the nonce valid until its ten-minute
  expiry. Single-use Google authorization codes and required matching random
  state prevent this observation alone from establishing an account takeover.
- Fix: clear state on every terminal authenticated callback response and ignore
  request Host when constructing redirects. Tests cover mismatch, missing code,
  provider denial and exchange failure. Mitigation: existing short expiry,
  HttpOnly/Secure/Lax scoped cookie; explicit profile-bound OAuth attempts can
  further harden account switching during consent.
- False-positive limits: state is random 32 bytes (`src/lib/google/oauth.ts:34-35`)
  and checked before token exchange; this is cleanup/lifecycle hardening rather
  than a confirmed OAuth bypass. Four regressions failed before the fix and pass
  afterward. Full real-provider behavior is still unverified.

## Verified control checklist and limits

| Control | Evidence and result |
| --- | --- |
| Authentication/authorization | `src/lib/auth/user-scope.ts:9-24` verifies Auth user, active trusted profile and trainer ID; `src/lib/auth/require-user.ts:6-9` denies unapproved users. Settings and API handlers authorize on server; navigation hiding is not trusted. |
| Tenant/RLS ownership | `supabase/migrations/202609050001_initial_schema.sql:324-345` scopes private helpers to `auth.uid()` with fixed search paths; `:414-464` constrains normalized data; `:483-488` denies browser roles OAuth credentials. `202609100001_admin_workflows.sql:47-51` obtains admin organization from trusted auth. Existing PGlite tests exercise denied roles/foreign targets; real deployed `rls.sql` remains required. |
| Refresh-token encryption | `src/lib/google/crypto.ts:3-28` uses AES-256-GCM, random 12-byte IV, 16-byte tag and a 32-byte environment key; `src/lib/google/oauth.ts:55-56` encrypts stored refresh/access tokens. Corruption/wrong-key tests pass. |
| OAuth state | `src/app/api/google/connect/route.ts:11-19` issues random state with ten-minute HttpOnly/Secure/Lax callback-scoped cookie; callback `:23-24` checks before exchange. Item 7 resolved. |
| CSRF-sensitive actions | Item 1 resolved on all cookie-authenticated POST route handlers. Login Server Action uses framework origin validation. GET Sheets consent still uses state. |
| Webhook token | `src/features/sync/orchestration.ts:25-30,82-98` uses timing-safe HMAC token comparison, active stored channel/resource, expiry and monotonic message number. Drive notifications are header-token authenticated; generic raw-body signature advice does not apply to this protocol. Existing tests cover forged/expired/duplicate events. |
| Cron secret | `src/features/sync/http-handlers.ts:14-17` fails closed without secret and timing-safe compares `Bearer` authorization. No cookie-based auth/CSRF exemption for admin APIs. |
| Input/SSRF | Zod command allowlists reject caller-supplied tenant/role and unrecognized fields. Sheets URL extracts only an ID from docs.google.com, then calls fixed Google SDK hosts; it does not fetch the submitted URL. Payload limits still item 4. |
| Safe logging/errors | No application console/logger secret dumps found in `src`. Google and DB errors become generic messages or classified codes (`src/features/admin/http.ts:6-8`, `src/features/sync/http-handlers.ts:17,26`). Edge/provider logs remain to inspect. |
| Caching/client exposure | Middleware sends private,no-store; protected server paths read cookies. Browser queries receive selected normalized columns; OAuth/service keys have no NEXT_PUBLIC prefix. No dynamic HTML/eval/storage sinks found in app sources. |
| Dependencies | Lockfile committed; PostCSS 8.5.26, Next 15.5.25. Production audit: no known vulnerabilities. Frozen install and repeated audit required in CI. |

No user files, credentials or live data were deleted or exported during this review.
Generated screenshots show fictional demo rows only.
