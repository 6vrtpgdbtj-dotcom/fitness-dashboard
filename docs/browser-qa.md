# Browser quality gate

Run `pnpm install --frozen-lockfile`, `pnpm playwright install chromium`,
`pnpm build`, then `pnpm playwright test`. The default server runs the production
build on 127.0.0.1:3100 and refuses to reuse an unknown running process.
Set `E2E_BASE_URL` to check an already running server, including `pnpm start` after
the production build. Screenshots, failure traces and CLI evidence are under
`output/playwright/` (ignored by Git; do not commit authenticated storage state).

The local suite checks actual browser rendering at 1440×900, 768×1024 and 390×844
for both roles; no page overflow; keyboard focus; chart/table interaction;
44px mobile targets; mobile class/renewal ordering; reduced motion; loading-to-loaded
metric/chart bounds at all three viewports for both roles; loading and
failure screens; login error copy; callback redirect handling; anonymous route
protection; and response headers. `/demo` is fictional data, not an auth bypass
or proof of database isolation. Bounds assertions compare left edge/width within
1px and reserved height within 15% of the representative loaded panel. They are
not a full-route CLS guarantee: toolbars and variable-length work queues move
the panels vertically, and the production route fallback has a different shell.

## Live Supabase gate — not executed in this environment

Three tests deliberately skip unless explicit environment settings are supplied.
These skips must not be counted as production acceptance. No `.env.local`, Docker
runtime, approved accounts or Google consent were available during Task 9.

Use a dedicated disposable Supabase project, apply every migration, and execute
`supabase/tests/rls.sql` using the setup in `supabase/README.md`. Seed an approved
administrator, an active trainer and a second tenant. Configure Google identity
login, app callback allowlist and the separate Sheets OAuth client. Log in as each
role via the real Google button on the exact origin/protocol used by the test
server (cookie domain/Secure rules still apply) and save separate Playwright storage states outside
version control. These state files contain credentials and must never be attached
as QA evidence. Set `E2E_ADMIN_STATE`, `E2E_TRAINER_STATE` to their absolute paths.
The automated session tests consume an existing real login; they do not automate
Google's consent screen or prove a fresh identity-provider round trip.

For deterministic Google reads on the integration server, use Node 24's TypeScript
preloader before starting Next from this repository:

```powershell
$env:E2E_MOCK_GOOGLE = '1'
$env:NODE_OPTIONS = '--import ./tests/fixtures/google-api.ts'
pnpm dev --hostname 127.0.0.1 --port 3100
```

This fixture exists only under `tests/`; there is no production auth bypass or
Google mock endpoint. It intercepts the actual Google SDK HTTP transport for one
synthetic spreadsheet ID. It does not mock Supabase. Store a **synthetic** encrypted
Google credential for the seeded admin in the isolated database, using the same
AES-GCM helper/key format as the app, so the production authorization adapter runs.
Use the separate real-Google smoke below to test real credential consent/storage.
Never point this test server at a production database or use real Google tokens
with the fixture. Clear these shell-only environment variables afterward.

Set `E2E_BASE_URL=http://127.0.0.1:3100`, then run the administrator session test to
connect `https://docs.google.com/spreadsheets/d/e2e-fitness-sheet/edit`. Seed its
direct trainer assignment and a confirmed member mapping for the `회원` tab.
The fixture produces `QA 회원`, external ID `QA-001`, remaining balance 4. The
seeded source must be visible to the approved trainer; a second tenant/member must
remain invisible. Verify both through PostgREST/RLS and the actual dashboard.

For the recovery test, restart the fixture server with `E2E_GOOGLE_OUTAGE=1`, set
`E2E_CONNECTION_ID` to that synthetic connection, and provide the server's
`CRON_SECRET` in the test process. Run only the live recovery test. It forces the
manual sync to exhaust Google retries, writes the local test recovery signal, then
polls real reconciliation. Allow up to eight minutes: SQL deliberately schedules
retry five minutes later. The test server and test runner must share this checkout
and the `output/playwright/` directory. Use one worker and do not run a separate
scheduler against the isolated project. The timestamped/source-key SQL tests cover
idempotence separately; live acceptance must also confirm one canonical member.

## Manual real-Google smoke — required before deployment

1. Remove the fixture environment variables and restart the server with HTTPS,
   production build, canonical app origin, real Supabase and real OAuth settings.
2. Log in through Google as the approved admin, verify the PKCE round trip and
   session cookie attributes, then separately authorize read-only Sheets access.
3. Connect a dedicated Google Sheet, confirm discovered tabs/header mapping and
   one successful import. Edit a row in Google; verify webhook/cron refresh reaches
   the dashboard without duplicates and no writeback touches the source.
4. Revoke sheet access, verify a safe error and retained last successful data,
   restore access and reconcile. Verify credentials never appear in responses,
   screenshots, logs or database roles available to browser clients.
5. Log in as the approved trainer. Check only assigned records, no settings or
   admin API access, second-tenant isolation, and Realtime refresh after token
   renewal. Inactive and unapproved accounts must be refused.

## Executable deployment acceptance — blocked until prerequisites are supplied

Do not count the following three skipped journeys as passed. An operator must
provide an isolated migrated Supabase project, approved admin/trainer accounts,
second-tenant fixtures, Google OAuth setup, canonical HTTPS origin and fresh
storage states. Run from this checkout with those environment variables set:

```powershell
# No credentials or authenticated state files belong in source control/artifacts.
pnpm playwright test --grep 'live Supabase administrator session' --workers=1
pnpm playwright test --grep 'live Supabase trainer session' --workers=1
# Separate fixture-server outage setup described above is required for this run.
pnpm playwright test --grep 'live Google failure and Supabase reconciliation' --workers=1
```

Record each actual pass/fail and the deployment revision; any skip is still a
blocked acceptance item. Also execute `supabase/tests/rls.sql` and the real-Google
smoke above; the transport fixture cannot establish Google consent/webhook behavior.

For the HttpOnly migration and Realtime gate, use HTTPS and real sessions (no
Google fixture), then record only redacted results, never token values:

1. Before rollout, revoke pre-change sessions through Supabase Auth's administrator
   session-revocation controls and require fresh login. Allow issued access JWTs
   to expire according to the project's revocation semantics; Google consent
   revocation alone is not Supabase session revocation. Clear old app browser storage
   and cookies; do not reuse old Playwright states. Merely deploying HttpOnly does
   not invalidate an already-stolen refresh token or rewrite an existing cookie.
2. Fresh Google login: inspect `sb-…-auth-token` and PKCE cookie writes in browser
   Network/Application panels; every chunk must be HttpOnly, Secure, SameSite=Lax,
   Path=/, with no broad Domain. `document.cookie` must not contain auth chunks;
   localStorage/sessionStorage must contain no Supabase session. Inspect response
   headers locally, but do not save token-bearing HAR/traces/screenshots.
3. In the signed-in browser console run the following assertion-only check:

   ```javascript
   const r = await fetch('/api/realtime/token', {method:'POST', credentials:'same-origin', cache:'no-store'});
   const b = await r.json();
   console.assert(r.status === 200 && r.headers.get('cache-control').includes('no-store'));
   console.assert(Object.keys(b).sort().join(',') === 'accessToken,expiresAt');
   console.assert(typeof b.accessToken === 'string' && b.expiresAt > Date.now()/1000);
   // Do not print b or persist its accessToken.
   ```

   A credentialed request with a foreign/absent Origin must return 403 without
   accessing Auth. Test using the isolated Playwright request context, not a
   command containing a copied credential. Inactive/unapproved accounts must
   receive 403; signed-out accounts must receive 401 when configured normally.
4. Keep an authenticated dashboard open past the configured JWT expiry (or use
   a short TTL only in the isolated project). Confirm the heartbeat handoff
   rotates cookies with all attributes retained, the private channel remains
   subscribed, and a real sheet-sync event refreshes the dashboard once. Repeat
   after network disconnect/reconnect and with both roles; unrelated tenant
   events/rows must remain inaccessible. Do not infer success solely from the
   status text or a mocked SDK.
5. Deactivate a test profile while its page remains open; after the next handoff
   refresh, verify the endpoint denies it and private data/events are inaccessible.
   Account/session revocation semantics and RLS must be checked on the deployed
   Supabase service; local source tests do not establish provider revocation.

Edge rate/payload limits and strict script CSP still require resolution or explicit
operational acceptance; see numbered findings in `security-review.md`. No production
security sign-off is implied by deterministic local tests.
