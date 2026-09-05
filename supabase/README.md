# Authentication and schema setup

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the canonical
`NEXT_PUBLIC_APP_URL` in `.env.local`. The app uses the anon key with the current
user session, so database RLS applies to server and browser queries alike.
Service-role access belongs only in trusted sync/administration server code.

Enable Google in Supabase Auth and configure the Google OAuth web client there.
Google redirects to the Supabase project's `/auth/v1/callback`; Supabase then
redirects to this app's `/auth/callback`. Add the app callback to the Supabase
redirect allowlist. App login uses only Google identity scopes. Sheets consent
and encrypted token storage are a separate administrator workflow.

## Approval and first administrator

A successful Google authentication does not grant application access. A matching
`profiles` row must have `is_active = true`, a trusted `organization_id`, and the
role `admin` or `trainer`. Trainers must have a `trainer_id` in that organization.
No trigger creates or approves profiles from user-editable OAuth metadata.

For first setup, attempt Google login once to create the Auth user, then a trusted
operator creates the first profile through the Supabase SQL editor. Use the actual
Auth user UUID and one organization UUID generated for this branch. For example:

```sql
-- Replace these placeholders; do not run this example unchanged.
insert into public.profiles (id, organization_id, role, display_name, is_active)
values ('AUTH_USER_UUID', 'ORGANIZATION_UUID', 'admin', '관리자', true);
```

Subsequent trainer provisioning inserts a `trainers` row followed by an approved
profile referencing its UUID. Email invitation and first-login matching are the
later user-management task, not automatic approval in this migration.

## Database contracts

- Normalized tables: `members`, `registrations`, `leads`, `classes`. Their
  `trainer_id` is the visibility owner; `sales_trainer_id` on registrations is
  descriptive and does not widen visibility. Analytics filter `record_status = 'valid'`.
- Source identity: organization + source connection + tab + source record key.
  UUID tab IDs refer to `sheet_tabs.id`; Google's numeric tab ID is `google_sheet_id`.
  Repeated imports upsert this composite key. Composite foreign keys prevent
  cross-organization trainer, member, tab, snapshot, and mapping references.
- `mapping_confidence` is 0–1. Mapping versions, snapshots, and audit events grant
  administrators select/insert only. A trusted, audited service workflow is needed
  for historical deletion. Source payloads are only in admin-readable snapshots.
- Trainers can only select their own normalized rows, trainer row, and profile.
  They cannot modify data or view connections, tabs, mappings, snapshots, sync
  jobs, or audit events. Inactive profiles have no business-data access.
- `oauth_credentials` has RLS and no anon/authenticated grants or policies,
  including administrators. Only service-role code can store/read encrypted
  ciphertext. Use `organization_id + profile_id + provider` as the key; never
  include this table in browser queries, logs, or Realtime publications.
- RLS helper functions live in the unexposed `private` schema with fixed search
  paths. Each derives scope from `auth.uid()` and approved profiles.
- Keep `src/middleware.ts` matchers synchronized with new dashboard routes.
  Dashboard pages/actions/APIs also authorize at the data boundary using
  `requireUser()`. The dashboard route-group layout provides an additional check.

## Local verification

Install Supabase CLI, Docker, and a PostgreSQL `psql` client. On an isolated local
development database (reset discards that database's current contents):

```powershell
supabase start
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
pnpm vitest run src/lib/auth
```

The SQL test seeds two organizations and multiple roles in one transaction,
executes actual queries under `authenticated`/`anon`, tests trainer isolation,
admin tenant boundaries, private-table denial, profile self-escalation, writes,
duplicate source records, and cross-tenant references, then rolls back.

Vitest's `schema.test.ts` only checks migration structure. It does not execute
PostgreSQL policies. Google account consent, PKCE cookie round trips, migrations,
and RLS must also be checked against a configured Supabase environment before
production deployment.
