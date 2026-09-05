# 1986 FITNESS Sheets Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a responsive multi-user dashboard that lets one administrator connect any number of differently structured Google Sheets and gives each trainer access only to their own normalized performance data.

**Architecture:** A Next.js application owns Google OAuth callbacks, Drive notifications, Sheets reads, normalization, and dashboard APIs. Supabase stores encrypted connection metadata, immutable source snapshots, versioned mappings, normalized business records, sync jobs, and role-scoped user profiles; Row Level Security and server authorization enforce administrator and trainer boundaries. Google Drive push notifications trigger sheet-specific syncs, a protected scheduled endpoint reconciles missed events, and Supabase Realtime refreshes connected dashboards.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Supabase Auth/PostgreSQL/Realtime, Google APIs Node client, Zod, Vitest, Testing Library, Playwright, Vercel

**Spec:** `docs/superpowers/specs/2026-09-05-fitness-sheets-dashboard-design.md`

## Global Constraints

- The administrator authorizes Google once; trainers never connect Google Sheets.
- Support three or more Google Sheets with no application-level connection limit.
- Never modify source spreadsheets; all Google access is read-only.
- Continue syncing healthy connections when one sheet fails.
- Preserve raw snapshots, mapping versions, normalized history, and audit records.
- Enforce administrator and trainer access in PostgreSQL RLS and server APIs.
- Do not store full phone numbers by default; retain only the final four digits when present.
- Use Pretendard Variable for Korean UI and Archivo for brand text and primary numeric metrics.
- Use a dense charcoal and warm-black interface with restrained lime accents and a mobile bottom navigation transformation.
- Deploy the application to Vercel and verify Google callback, webhook, cron, authentication, desktop, and mobile flows.

---

### Task 1: Application foundation and visual system

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Create: `src/components/app-shell.tsx`
- Create: `src/components/__tests__/app-shell.test.tsx`
- Create: `.env.example`

**Interfaces:**
- Produces: `AppShell({ children, role, displayName })` used by all authenticated pages.
- Produces: CSS tokens `--surface-0`, `--surface-1`, `--accent`, `--text-1`, `--text-2`.

- [ ] **Step 1: Scaffold the Next.js TypeScript application and install dependencies**

Run:

```powershell
pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
pnpm add @supabase/ssr @supabase/supabase-js googleapis zod server-only
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test
```

Expected: the App Router starts with `pnpm dev`, and the listed packages appear in `package.json`.

- [ ] **Step 2: Write the failing application-shell test**

```tsx
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/app-shell";

it("shows trainer navigation without administrator settings", () => {
  render(<AppShell role="trainer" displayName="정윤수"><div>개인 현황</div></AppShell>);
  expect(screen.getByText("개인 현황")).toBeInTheDocument();
  expect(screen.queryByText("시트 연결")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the test and verify the missing component failure**

Run: `pnpm vitest run src/components/__tests__/app-shell.test.tsx`

Expected: FAIL because `@/components/app-shell` does not exist.

- [ ] **Step 4: Implement the responsive shell and typography**

Implement `AppShell` with desktop sidebar navigation for overview, members, registrations, leads, classes, sheet connections, data review, and users. Render only overview, members, registrations, leads, and classes for trainers. Add a mobile bottom navigation at widths below 768px. In `globals.css`, self-host Pretendard Variable and Archivo under `public/fonts/`, apply Archivo only to `.brand-type` and `.metric-type`, and define the approved charcoal, warm-black, lime, border, success, warning, and danger tokens.

```tsx
export type AppRole = "admin" | "trainer";
const trainerNav = ["통합 현황", "회원 관리", "등록·매출", "상담 리드", "수업 현황"];
const adminNav = [...trainerNav, "시트 연결", "데이터 점검", "사용자 관리"];
export function AppShell(props: {
  children: React.ReactNode;
  role: AppRole;
  displayName: string;
}) {
  const items = props.role === "admin" ? adminNav : trainerNav;
  return (
    <div className="app-shell">
      <aside><nav aria-label="주 메뉴">{items.map((item) => <a key={item} href="#">{item}</a>)}</nav></aside>
      <section><header><span>{props.displayName}</span></header><main>{props.children}</main></section>
      <nav className="mobile-nav" aria-label="모바일 메뉴">{trainerNav.slice(0, 5).map((item) => <a key={item} href="#">{item}</a>)}</nav>
    </div>
  );
}
```

- [ ] **Step 5: Run component, lint, and production-build checks**

Run: `pnpm vitest run src/components/__tests__/app-shell.test.tsx && pnpm lint && pnpm build`

Expected: test PASS, lint exits 0, and Next.js production build exits 0.

- [ ] **Step 6: Commit the foundation**

```powershell
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json vitest.config.ts playwright.config.ts src public .env.example
git commit -m "feat: add fitness dashboard application shell"
```

### Task 2: Database schema, authentication, and row-level security

**Files:**
- Create: `supabase/migrations/202609050001_initial_schema.sql`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/auth/require-user.ts`
- Create: `src/lib/auth/__tests__/require-user.test.ts`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/middleware.ts`

**Interfaces:**
- Produces: `requireUser(): Promise<{ id: string; role: "admin" | "trainer"; trainerId: string | null }>`.
- Produces database tables: `profiles`, `trainers`, `sheet_connections`, `sheet_tabs`, `mapping_versions`, `raw_snapshots`, `members`, `registrations`, `leads`, `classes`, `sync_jobs`, `audit_events`.

- [ ] **Step 1: Write the failing authorization tests**

Mock Supabase session/profile queries and assert that `requireUser` redirects unauthenticated users, returns administrator scope, and returns a trainer ID for trainers.

```ts
expect(await requireUser()).toEqual({ id: "u1", role: "trainer", trainerId: "t1" });
```

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run src/lib/auth/__tests__/require-user.test.ts`

Expected: FAIL because the helper and Supabase clients do not exist.

- [ ] **Step 3: Create the SQL migration**

Define UUID primary keys, `organization_id` on every tenant-owned row, `source_connection_id`, `source_tab_id`, `source_record_key`, timestamps, JSONB source payloads, mapping confidence, record status, and unique constraints preventing duplicate normalized records. Create enums for `app_role`, `sync_status`, and `record_review_status`. Add indexes on organization, trainer, member, registration date, lead date, class date, and source-record keys.

Enable RLS on every tenant table. Administrator policies allow rows in their organization. Trainer policies allow rows whose `trainer_id` equals `profiles.trainer_id`. Deny trainers all access to `sheet_connections`, OAuth metadata, raw snapshots, mapping versions, sync jobs, and audit payloads.

- [ ] **Step 4: Implement Google login through Supabase Auth**

Create the login page with a server action calling `signInWithOAuth({ provider: "google" })`. The callback exchanges the auth code and redirects approved profiles to `/dashboard`. `middleware.ts` refreshes sessions and protects all dashboard routes.

- [ ] **Step 5: Implement and pass authorization tests**

Run: `pnpm vitest run src/lib/auth/__tests__/require-user.test.ts`

Expected: all authentication-scope tests PASS.

- [ ] **Step 6: Apply the migration to a local Supabase instance and test RLS**

Run:

```powershell
supabase start
supabase db reset
pnpm vitest run src/lib/auth
```

Expected: migrations apply cleanly; trainer queries cannot read another trainer's rows or any raw snapshot.

- [ ] **Step 7: Commit authentication and schema**

```powershell
git add supabase src/lib/supabase src/lib/auth src/app/auth src/app/login src/middleware.ts
git commit -m "feat: add role-scoped authentication and data schema"
```

### Task 3: Administrator Google authorization and sheet connections

**Files:**
- Create: `src/lib/google/oauth.ts`
- Create: `src/lib/google/crypto.ts`
- Create: `src/lib/google/sheets.ts`
- Create: `src/app/api/google/connect/route.ts`
- Create: `src/app/api/google/callback/route.ts`
- Create: `src/app/api/sheets/route.ts`
- Create: `src/app/(dashboard)/settings/sheets/page.tsx`
- Create: `src/components/sheets/add-sheet-dialog.tsx`
- Create: `src/lib/google/__tests__/crypto.test.ts`
- Create: `src/app/api/sheets/__tests__/route.test.ts`

**Interfaces:**
- Produces: `encryptSecret(value: string): string` and `decryptSecret(value: string): string` using AES-256-GCM.
- Produces: `getAuthorizedGoogleClient(connectionId: string): Promise<OAuth2Client>`.
- Produces: `readSpreadsheetMetadata(spreadsheetId: string): Promise<SpreadsheetMetadata>`.
- Produces REST: `POST /api/sheets` with `{ spreadsheetUrl, trainerId? }`.

- [ ] **Step 1: Write failing encryption and administrator-only route tests**

Assert encrypted output does not contain plaintext, decrypts exactly, rejects tampered authentication tags, rejects trainer requests with 403, and accepts valid Google Sheet URLs from administrators.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run src/lib/google/__tests__/crypto.test.ts src/app/api/sheets/__tests__/route.test.ts`

Expected: FAIL because the modules and route do not exist.

- [ ] **Step 3: Implement administrator Google OAuth**

Request only `drive.file`, `drive.metadata.readonly`, and `spreadsheets.readonly` scopes needed by the selected integration flow. Store access and refresh tokens encrypted with `GOOGLE_TOKEN_ENCRYPTION_KEY`. Validate callback state against an HttpOnly, SameSite=Lax, Secure cookie before storing credentials.

- [ ] **Step 4: Implement sheet registration**

Parse `/spreadsheets/d/{id}` URLs with Zod, verify the authorized Google client can read spreadsheet metadata, upsert the connection under the administrator's organization, and enqueue an initial `pending` sync job. Never accept an arbitrary organization ID from request JSON.

- [ ] **Step 5: Build the connection screen**

Show connected sheet name, assigned trainer, detected tabs, last successful sync, current status, and actions to sync now, change assignment, or disconnect. The add dialog accepts a Google Sheets URL and optional trainer assignment; it does not ask trainers to authorize Google.

- [ ] **Step 6: Run tests and build**

Run: `pnpm vitest run src/lib/google src/app/api/sheets && pnpm build`

Expected: tests PASS and production build exits 0.

- [ ] **Step 7: Commit the Google connection flow**

```powershell
git add src/lib/google src/app/api/google src/app/api/sheets src/app/\(dashboard\)/settings/sheets src/components/sheets
git commit -m "feat: connect administrator Google Sheets"
```

### Task 4: Schema discovery and resilient column mapping

**Files:**
- Create: `src/features/mapping/canonical-fields.ts`
- Create: `src/features/mapping/header-normalizer.ts`
- Create: `src/features/mapping/value-profiler.ts`
- Create: `src/features/mapping/map-columns.ts`
- Create: `src/features/mapping/types.ts`
- Create: `src/features/mapping/__fixtures__/three-trainer-sheets.ts`
- Create: `src/features/mapping/__tests__/map-columns.test.ts`
- Create: `src/components/sheets/mapping-review.tsx`

**Interfaces:**
- Produces: `normalizeHeader(value: string): string`.
- Produces: `profileColumn(values: unknown[]): ColumnProfile`.
- Produces: `mapColumns(input: MappingInput, history: ConfirmedMapping[]): MappingResult`.
- `MappingResult` contains `fields`, `confidence`, `unmappedHeaders`, `missingRequiredFields`, and `mappingFingerprint`.

- [ ] **Step 1: Add three representative sheet fixtures and failing tests**

Fixtures must include different tab names, `회원명/고객명/성명`, `실결제금액/결제액/매출`, reordered columns, extra columns, blank leading rows, merged title rows, and Korean spacing variants. Assert that known variations map automatically and an unknown required identity field is returned in `missingRequiredFields` without throwing.

- [ ] **Step 2: Run the mapping tests**

Run: `pnpm vitest run src/features/mapping/__tests__/map-columns.test.ts`

Expected: FAIL because mapping functions do not exist.

- [ ] **Step 3: Implement header normalization and synonym dictionaries**

Normalize Unicode, trim, lowercase Latin text, remove whitespace and punctuation, and preserve Korean characters. Define canonical fields and synonyms for member, registration, lead, and class domains. Keep deterministic exact and synonym matches ahead of fuzzy scoring.

```ts
export function normalizeHeader(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/[\s_\-./()]+/g, "");
}
```

- [ ] **Step 4: Implement type profiling and confidence scoring**

Profile non-empty values as date, integer, money, percentage, status vocabulary, identifier, or free text. Score confirmed historical mapping at 1.0, exact canonical at 0.98, synonym at 0.94, and combined header/type similarity below that. Auto-accept only scores at or above 0.88 with a margin of at least 0.12 over the second candidate.

- [ ] **Step 5: Implement mapping review UI**

Display source header, sample values, proposed standard field, confidence, and a select control for administrator correction. Saving creates a new immutable mapping version; it never overwrites an earlier version.

- [ ] **Step 6: Run mapping and component tests**

Run: `pnpm vitest run src/features/mapping src/components/sheets`

Expected: all fixture variations PASS, including reordered and newly added columns.

- [ ] **Step 7: Commit resilient mapping**

```powershell
git add src/features/mapping src/components/sheets/mapping-review.tsx
git commit -m "feat: add resilient sheet column mapping"
```

### Task 5: Idempotent normalization and historical records

**Files:**
- Create: `src/features/sync/fingerprint.ts`
- Create: `src/features/sync/normalize-member.ts`
- Create: `src/features/sync/normalize-registration.ts`
- Create: `src/features/sync/normalize-lead.ts`
- Create: `src/features/sync/normalize-class.ts`
- Create: `src/features/sync/apply-sync.ts`
- Create: `src/features/sync/types.ts`
- Create: `src/features/sync/__tests__/apply-sync.test.ts`

**Interfaces:**
- Produces: `sourceRecordKey(connectionId, tabId, canonicalIdentity): string`.
- Produces: `applySync(input: SyncInput, db: SyncRepository): Promise<SyncResult>`.
- `SyncResult` contains inserted, updated, unchanged, reviewRequired, and rejected counts per domain.

- [ ] **Step 1: Write failing idempotency and partial-failure tests**

Assert that running the same snapshot twice produces zero second-run inserts, sorting rows does not duplicate data, changing a payment updates the current record while preserving prior snapshot history, and a malformed row enters review while valid rows commit.

- [ ] **Step 2: Run sync tests**

Run: `pnpm vitest run src/features/sync/__tests__/apply-sync.test.ts`

Expected: FAIL because normalization and sync functions do not exist.

- [ ] **Step 3: Implement deterministic fingerprints**

Use SHA-256 over source connection, tab ID, canonical identifier, and stable business keys. Never use row number as the sole identity. Strip full phone numbers after extracting the final four digits.

- [ ] **Step 4: Implement domain normalizers**

Parse dates in supported ISO and Korean display formats, numeric strings with commas and currency symbols, registration categories, member status, lead status, and class status. Return structured field-level issues instead of throwing for a single invalid field.

- [ ] **Step 5: Implement transactional sync application**

Insert the immutable raw snapshot first. Apply valid normalized records with database upserts keyed by organization and source record key. Store changed values in audit events, preserve source provenance, and mark unresolved required-field records `review_required` outside analytical aggregates.

- [ ] **Step 6: Run tests and migration checks**

Run: `pnpm vitest run src/features/sync && supabase db reset`

Expected: all idempotency, sorting, history, and partial-failure tests PASS; schema resets cleanly.

- [ ] **Step 7: Commit sync normalization**

```powershell
git add src/features/sync supabase
git commit -m "feat: normalize sheet data with idempotent history"
```

### Task 6: Drive notifications, sync orchestration, retries, and reconciliation

**Files:**
- Create: `src/features/sync/run-sheet-sync.ts`
- Create: `src/features/sync/register-watch.ts`
- Create: `src/features/sync/retry-policy.ts`
- Create: `src/app/api/google/notifications/route.ts`
- Create: `src/app/api/cron/reconcile-sheets/route.ts`
- Create: `src/app/api/sheets/[id]/sync/route.ts`
- Create: `src/features/sync/__tests__/orchestration.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Produces: `runSheetSync(connectionId: string, reason: SyncReason): Promise<SyncResult>`.
- Produces: `registerWatch(connectionId: string): Promise<{ channelId: string; expiration: Date }>`.
- REST: Google notification receiver, protected reconciliation cron, administrator manual sync.

- [ ] **Step 1: Write failing webhook and retry tests**

Assert notification tokens are verified, duplicate message numbers do not create duplicate jobs, unknown event types return 204, expired credentials mark only the affected connection, 429/5xx responses use bounded exponential backoff, and cron rejects missing `CRON_SECRET`.

- [ ] **Step 2: Run orchestration tests**

Run: `pnpm vitest run src/features/sync/__tests__/orchestration.test.ts src/app/api/google/notifications src/app/api/cron`

Expected: FAIL because routes and orchestration do not exist.

- [ ] **Step 3: Implement watch registration and notification verification**

Create one Drive `files.watch` channel per spreadsheet with a random channel ID and HMAC-backed channel token. Store resource ID, last message number, and expiration. Verify headers and token before enqueueing a sync; return 204 quickly and run processing outside the acknowledgement path.

- [ ] **Step 4: Implement isolated sync execution and retry policy**

Lock per connection, read the latest sheet state, run discovery/mapping/normalization, persist the result, and release the lock. Retry 429 and transient 5xx responses with jittered delays of 1, 2, 4, 8, and 16 seconds. Do not retry revoked authorization or invalid spreadsheet IDs.

- [ ] **Step 5: Implement reconciliation and watch renewal**

The protected cron endpoint finds stale successful connections, failed retryable jobs, and watches expiring within 24 hours. It syncs and renews them independently so one failure cannot abort the batch.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/reconcile-sheets", "schedule": "*/5 * * * *" }]
}
```

- [ ] **Step 6: Run orchestration tests**

Run: `pnpm vitest run src/features/sync src/app/api/google/notifications src/app/api/cron src/app/api/sheets`

Expected: webhook, isolation, retry, renewal, and reconciliation tests PASS.

- [ ] **Step 7: Commit orchestration**

```powershell
git add src/features/sync src/app/api/google/notifications src/app/api/cron src/app/api/sheets vercel.json
git commit -m "feat: synchronize sheets from notifications and reconciliation"
```

### Task 7: Administrator and trainer dashboards

**Files:**
- Create: `src/features/analytics/queries.ts`
- Create: `src/features/analytics/types.ts`
- Create: `src/app/(dashboard)/dashboard/page.tsx`
- Create: `src/app/(dashboard)/members/page.tsx`
- Create: `src/app/(dashboard)/registrations/page.tsx`
- Create: `src/app/(dashboard)/leads/page.tsx`
- Create: `src/app/(dashboard)/classes/page.tsx`
- Create: `src/components/dashboard/metric-card.tsx`
- Create: `src/components/dashboard/revenue-chart.tsx`
- Create: `src/components/dashboard/conversion-funnel.tsx`
- Create: `src/components/dashboard/renewal-table.tsx`
- Create: `src/components/dashboard/realtime-refresh.tsx`
- Create: `src/features/analytics/__tests__/queries.test.ts`

**Interfaces:**
- Produces: `getDashboardData(scope: UserScope, period: DateRange): Promise<DashboardData>`.
- Produces: shared, responsive dashboard components receiving typed data only.

- [ ] **Step 1: Write failing aggregate and scope tests**

Seed two trainers and assert administrator totals include both, trainer totals include only the matching trainer, refunds are separated, new and renewed registrations remain distinct, valid completed consultations form the conversion denominator, and review-required records are excluded.

- [ ] **Step 2: Run analytics tests**

Run: `pnpm vitest run src/features/analytics/__tests__/queries.test.ts`

Expected: FAIL because analytics queries do not exist.

- [ ] **Step 3: Implement scoped analytical queries**

Calculate total and period revenue, new registration count, renewed registration count, consultation conversion rate, source conversion, average payment, average sessions, class count, remaining sessions, expected depletion date, and renewal candidates. Accept `UserScope` from `requireUser`; never accept trainer scope from URL query parameters.

- [ ] **Step 4: Build administrator dashboard pages**

Implement the approved desktop composition: compact title row, four key metrics, new-versus-renewed revenue chart, consultation funnel, connection health, renewal candidates, trainer comparison, and dense detail tables. Add date and trainer filters only where they change results.

- [ ] **Step 5: Build trainer dashboard states**

Use the same components with trainer-scoped data. Put personal revenue, registrations, today's classes, assigned members, remaining sessions, and renewal candidates first. Remove connection, mapping, audit, and user-management navigation and actions.

- [ ] **Step 6: Subscribe to safe realtime invalidation events**

Subscribe to an organization or trainer-specific private channel. On a successful sync broadcast, call `router.refresh()` with a short debounce. Do not send raw member or payment rows through broadcast payloads.

- [ ] **Step 7: Run analytics, component, and build tests**

Run: `pnpm vitest run src/features/analytics src/components/dashboard && pnpm lint && pnpm build`

Expected: scoped aggregate tests PASS, components render accessible labels, lint exits 0, and production build exits 0.

- [ ] **Step 8: Commit dashboards**

```powershell
git add src/features/analytics src/app/\(dashboard\) src/components/dashboard
git commit -m "feat: add administrator and trainer dashboards"
```

### Task 8: Data review, trainer administration, and audit views

**Files:**
- Create: `src/app/(dashboard)/settings/data-review/page.tsx`
- Create: `src/app/(dashboard)/settings/users/page.tsx`
- Create: `src/app/api/review/[id]/route.ts`
- Create: `src/app/api/trainers/route.ts`
- Create: `src/components/review/record-review-table.tsx`
- Create: `src/components/users/trainer-form.tsx`
- Create: `src/app/api/review/__tests__/route.test.ts`
- Create: `src/app/api/trainers/__tests__/route.test.ts`

**Interfaces:**
- REST: administrator-only review resolution and trainer invitation/assignment routes.
- Produces audit events for mapping confirmation, merge, trainer assignment, disconnect, and deletion.

- [ ] **Step 1: Write failing administrator-only tests**

Assert trainers receive 403 for review and user-management routes, administrator actions require organization-owned targets, member merges preserve aliases and source provenance, and every successful mutation writes an audit event.

- [ ] **Step 2: Run route tests**

Run: `pnpm vitest run src/app/api/review src/app/api/trainers`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement review resolution and safe member merge**

Allow field correction, mapping confirmation, rejected-record dismissal, and member candidate merge. Execute member merge in one database transaction, move dependent records to the retained member, store aliases, and write before/after identifiers to a redacted audit event.

- [ ] **Step 4: Implement trainer invitation and assignment**

Administrators enter an email, display name, and active state. On first Google login, match the verified email to the invitation. Sheet assignment can be direct to one trainer or derived from a mapped trainer column.

- [ ] **Step 5: Build review and user-management pages**

Use compact tables with source header, sample value, issue reason, proposed mapping, and administrator action. Show no raw OAuth data or full phone values. Require a confirmation dialog for destructive historical deletion.

- [ ] **Step 6: Run tests and build**

Run: `pnpm vitest run src/app/api/review src/app/api/trainers src/components/review src/components/users && pnpm build`

Expected: tests PASS and production build exits 0.

- [ ] **Step 7: Commit administration tools**

```powershell
git add src/app/\(dashboard\)/settings src/app/api/review src/app/api/trainers src/components/review src/components/users
git commit -m "feat: add data review and trainer administration"
```

### Task 9: Browser flows, security review, and responsive quality gate

**Files:**
- Create: `e2e/admin-sheet-connection.spec.ts`
- Create: `e2e/trainer-scope.spec.ts`
- Create: `e2e/responsive-dashboard.spec.ts`
- Create: `e2e/sync-recovery.spec.ts`
- Create: `tests/fixtures/google-api.ts`
- Create: `docs/security-review.md`

**Interfaces:**
- Consumes the complete local application and seeded Supabase database.
- Produces repeatable desktop/mobile browser evidence and a resolved security checklist.

- [ ] **Step 1: Write Playwright tests for the four critical journeys**

Cover administrator login and sheet connection, trainer login and forbidden administrator pages, desktop at 1440×900, tablet at 768×1024, mobile at 390×844, and a failed Google read followed by successful reconciliation. Mock Google APIs with deterministic fixtures while retaining a separate manual real-Google smoke test.

- [ ] **Step 2: Run Playwright tests and capture expected failures**

Run: `pnpm playwright test`

Expected: any missing accessible labels, mobile overflow, or incomplete flows fail before fixes.

- [ ] **Step 3: Fix responsive and interaction defects**

Verify no horizontal page overflow, readable Korean labels, 44px mobile targets, visible keyboard focus, non-clipped charts, stable loading skeletons, and mobile-first ordering of today's classes and renewal candidates. Add reduced-motion handling to all animated chart transitions.

- [ ] **Step 4: Perform the JavaScript/TypeScript security review**

Use the installed `security-best-practices` skill. Verify OAuth state, encrypted refresh tokens, HttpOnly cookies, route authorization, RLS policies, tenant ownership, input validation, webhook token verification, cron secret verification, rate limits, safe logging, CSRF-sensitive actions, and dependency audit. Record concrete evidence and resolved findings in `docs/security-review.md`.

- [ ] **Step 5: Run the complete local quality gate**

Run:

```powershell
pnpm lint
pnpm vitest run
pnpm build
pnpm playwright test
pnpm audit --prod
```

Expected: lint 0 errors, unit/integration tests 0 failures, build exits 0, Playwright 0 failures, and no unresolved high or critical production dependency vulnerabilities.

- [ ] **Step 6: Commit verified application quality**

```powershell
git add e2e tests docs/security-review.md src
git commit -m "test: verify dashboard security and browser flows"
```

### Task 10: Supabase and Vercel deployment

**Files:**
- Modify: `.env.example`
- Create: `docs/deployment.md`
- Modify: `README.md`

**Interfaces:**
- Produces a live Vercel URL, configured Supabase production database, Google OAuth callback, Drive notification endpoint, and reconciliation cron.

- [ ] **Step 1: Document exact production environment variables**

Include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_NOTIFICATION_SECRET`, `CRON_SECRET`, and `NEXT_PUBLIC_APP_URL`. State who creates each value and where it is configured; never include real secrets.

- [ ] **Step 2: Create and migrate the production Supabase project**

Link the CLI, push migrations, enable Google Auth, configure the production site URL and redirect URL, and create the first administrator invitation/profile through a migration or one-time audited bootstrap command.

Run:

```powershell
$env:SUPABASE_PROJECT_REF = "the production project reference copied from the Supabase dashboard"
supabase link --project-ref $env:SUPABASE_PROJECT_REF
supabase db push
```

Expected: all migrations apply and RLS remains enabled on every tenant table.

- [ ] **Step 3: Configure Google Cloud**

Enable Google Sheets API and Drive API, create an OAuth web client, add the production callback URI `/api/google/callback`, add the Supabase auth callback URI, and configure the OAuth consent screen. Share no client secret in source control.

- [ ] **Step 4: Deploy with the installed Vercel deployment skill**

Create the Vercel project, add production environment variables, deploy, and record the immutable deployment URL and production domain.

Expected: Vercel build succeeds and `vercel.json` registers the reconciliation cron.

- [ ] **Step 5: Register live Drive watches and complete production smoke tests**

Connect three differently structured real Google Sheets, confirm initial import, edit one value in each source, verify automatic dashboard refresh, reorder a column, add a new column, change a known header synonym, and confirm continued syncing. Log in as a trainer and confirm another trainer's member and revenue endpoints return no rows.

- [ ] **Step 6: Run final deployment verification**

Run the Playwright smoke project against `NEXT_PUBLIC_APP_URL`, inspect Vercel function logs for callbacks and cron, inspect sync jobs for three successful connections, and confirm no formula or source data is written back to Google Sheets.

Expected: live desktop/mobile flows pass, three sheets sync after edits, role isolation holds, webhook and reconciliation records are successful, and no unresolved production error remains.

- [ ] **Step 7: Commit deployment documentation**

```powershell
git add .env.example docs/deployment.md README.md
git commit -m "docs: add production deployment runbook"
```
