# 운영 배포 및 인수 절차

이 문서는 실행 절차이며 실환경 검증 결과가 아닙니다. 운영자가 소유한 Supabase·Google
Cloud·Vercel 프로젝트, 승인된 사용자, HTTPS 도메인을 준비해야 합니다. 환경별로 데이터베이스,
OAuth 클라이언트, 암호화 키와 알림/cron 비밀을 분리합니다. 데모 미리보기에는 운영 자격 증명을
넣지 않습니다. 유료 리소스 생성이나 요금제 변경은 별도 운영 결정입니다.

## 1. 환경변수 계약

로컬은 Git에서 제외되는 `.env.local`, 배포는 Vercel Project Settings → Environment Variables에
설정합니다. Production과 Preview의 범위를 각각 지정하고 변경 후 다시 빌드/배포합니다.
`NEXT_PUBLIC_*` 값은 빌드 결과에 포함되므로 서버 전용 비밀을 넣어서는 안 됩니다.
어떤 비밀도 소스, 티켓, 채팅, 스크린샷, 빌드 로그에 기록하지 않습니다.

| 정식 환경변수 | 생성/확인 담당자와 위치 | 값과 용도 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 운영자, Project Settings/API | 해당 환경의 Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 운영자, API Keys | 해당 프로젝트의 anon 공개 키, 사용자 세션과 함께 RLS 적용 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 운영자, API Keys | 서비스 역할 키, 서버 동기화 전용. RLS를 우회하므로 브라우저에 노출 금지 |
| `NEXT_PUBLIC_APP_URL` | 배포 운영자, Vercel Domains | 정확한 HTTPS origin, 경로·후행 `/` 제외. 예: `https://fitness.example.invalid` |
| `GOOGLE_CLIENT_ID` | Google Cloud 운영자, OAuth web client | 시트 연결용 웹 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud 운영자, 같은 웹 클라이언트 | 위 ID와 짝인 서버 전용 secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Google Cloud/배포 운영자 | 앱 origin + `/api/google/callback`; Google에 등록한 문자열과 완전히 일치 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 보안 운영자, 비밀 관리자 | 32바이트 난수의 64자리 hex 또는 base64. 저장된 Google 토큰의 AES-256-GCM 암호화 |
| `GOOGLE_NOTIFICATION_SECRET` | 보안 운영자, 비밀 관리자 | 독립 난수, 최소 32문자. 32바이트 난수의 hex 권장. 채널별 HMAC 검증 |
| `CRON_SECRET` | 보안 운영자, 비밀 관리자 | 별도 32바이트 난수의 hex 권장. cron `Authorization: Bearer …` 인증 |

보안 운영자의 비밀 생성기를 사용해 세 비밀을 각각 생성하고 비밀 관리자에서 Vercel로
전달합니다. 암호화 키의 이전 버전을 보존하세요. 키만 교체하면 기존 암호문을 해독할 수
없습니다. 이 앱에는 자동 키 재암호화 기능이 없으므로 키 교체는 별도 마이그레이션 또는
관리자 Google 재동의를 포함한 작업입니다.

호환 전용 이름 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_WATCH_SECRET`은 각각 정식 이름이 비어 있거나 없을 때만 사용합니다. 정식 이름이
우선하며, 잘못된 짧은 정식 알림 secret을 기존 alias로 숨기지 않습니다. ID와 secret은
항상 함께 변경하고 이전 alias를 제거하세요. 값이 다른 두 세트를 유지하지 마세요.

`SUPABASE_PROJECT_REF`는 CLI 연결용 프로젝트 참조입니다. `SUPABASE_ACCESS_TOKEN` 및
데이터베이스 비밀번호는 운영자 CLI/비밀 관리자용이며 앱이나 공개 변수에 필요하지 않습니다.
`E2E_*`, Google mock용 `NODE_OPTIONS`는 테스트 환경 전용입니다. 운영 Vercel에 설정하지 마세요.

## 2. Supabase 프로젝트 준비와 마이그레이션

1. 운영자가 사용할 기존 프로젝트 또는 새 프로젝트를 확인합니다. 지역·백업·복구 방식과
   요금은 운영자가 선택합니다. 프로젝트 참조, 데이터베이스 호스트, 배포 대상 조직을 대조합니다.
2. Supabase CLI를 준비하고 운영자 터미널에서 `supabase login`을 실행합니다. 인증 파일과
   비밀번호를 저장소에 복사하지 않습니다. 아래 명령은 이 저장소 루트에서 실행합니다.
3. 먼저 별도의 검증 프로젝트에 모든 마이그레이션을 적용하고 아래 RLS 검증을 실행합니다.
   운영 데이터베이스 백업/복구 지점을 확인한 뒤 운영 대상을 연결합니다.

```powershell
$env:SUPABASE_PROJECT_REF = '<Supabase dashboard에서 확인한 운영 프로젝트 참조>'
supabase link --project-ref $env:SUPABASE_PROJECT_REF
supabase migration list --linked
supabase db push --dry-run
# 출력의 대상과 미적용 마이그레이션을 검토한 뒤 적용
supabase db push
supabase migration list --linked
```

명령 실패 시 다음 단계로 넘어가지 않습니다. 이미 적용된 SQL 파일을 수정하거나
`migration repair`로 실제 미적용 상태를 숨기지 않습니다. 운영에서 `supabase db reset`을
실행하지 않습니다. `supabase/migrations`의 SQL을 날짜 순서대로 모두 적용해야 하며 마지막은
`202609100003_replay_snapshot_refresh.sql`입니다. Realtime migration은 실제 Supabase의
`realtime.messages`, `realtime.topic()`, `realtime.send()`를 필요로 합니다.

운영 SQL Editor에서 읽기 전용으로 RLS가 꺼진 앱 테이블을 확인합니다. 결과가 0행이어야 합니다.
정책이 없는 서버 전용 테이블도 RLS를 끄지 않습니다.

```sql
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and not c.relrowsecurity;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname in ('public', 'realtime')
order by schemaname, tablename, policyname;
```

테이블 RLS 플래그만으로 격리를 증명할 수 없습니다. 별도 로컬 Supabase/Docker 또는
폐기 가능한 검증 프로젝트에서 `supabase/tests/rls.sql`을 실행합니다. 이 SQL은 실제
`anon`/`authenticated` 역할로 두 조직, 관리자, 트레이너, 비활성 계정을 검증하고 롤백합니다.
운영에 테스트 사용자를 주입하지 않습니다. `psql`에는 검증 DB의 password를 포함하지 않는
연결 문자열을 사용하고 password prompt 또는 안전한 PostgreSQL credential store를 사용합니다.

```powershell
# 검증 프로젝트의 호스트/사용자/포트를 Supabase Connect에서 확인하여 구성
psql 'host=<검증 DB host> port=<port> dbname=postgres user=<user> sslmode=require' -W -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
```

로컬 전용 명령은 [Supabase 안내](../supabase/README.md)에 있습니다. PGlite/Vitest 통과는
호스팅된 Supabase의 RLS·Auth·Realtime 검증을 대체하지 않습니다.

## 3. Google Cloud와 로그인 콜백

Google Cloud 프로젝트에서 Google Sheets API와 Google Drive API를 활성화하고 OAuth 동의
화면의 앱 이름, 운영 연락처, 승인 도메인, 개인정보 처리방침을 설정합니다. 사용자 유형과
요청 scope에 필요한 검증/게시 상태를 확인합니다. Testing 상태의 테스트 사용자만으로
운영 계정 접근과 장기 refresh token 사용이 보장되는 것은 아닙니다.

로그인과 시트 접근 동의는 두 흐름입니다. 같은 웹 클라이언트를 사용하면 아래 Google
redirect URI 두 개를 모두 등록하고, 환경/용도별로 분리한 클라이언트라면 각 해당 URI를
등록합니다. Supabase provider 설정에는 로그인용 클라이언트 ID/secret을 입력합니다.
Vercel `GOOGLE_CLIENT_ID/SECRET`에는 시트용 클라이언트 쌍을 입력합니다.

| 등록 위치 | 정확한 URI | 흐름 |
| --- | --- | --- |
| Google OAuth web client → Authorized redirect URIs | `https://<project-ref>.supabase.co/auth/v1/callback` | Google → Supabase 로그인 |
| Supabase Auth → URL Configuration → Site URL | `https://<app-domain>` | 앱의 canonical origin |
| Supabase Auth → Redirect URLs | `https://<app-domain>/auth/callback` | Supabase → 앱 PKCE callback |
| Google OAuth web client → Authorized redirect URIs | `https://<app-domain>/api/google/callback` | 관리자 시트 권한 동의 |
| Vercel `GOOGLE_OAUTH_REDIRECT_URI` | `https://<app-domain>/api/google/callback` | 위 Google 등록 값과 일치 |

Supabase 사용자 정의 Auth 도메인을 쓰면 대시보드가 표시하는 실제 provider callback을
사용합니다. origin/프로토콜/포트가 다르면 별도 allowlist 항목이 필요합니다. 운영 allowlist에
와일드카드 미리보기 도메인을 추가하지 않습니다. 별도 integration preview에는 그 환경의
정확한 origin과 전용 Supabase 프로젝트를 사용합니다.

Supabase Auth → Providers에서 Google을 활성화하고, 사이트 URL/redirect allowlist를 저장합니다.
로그인은 identity scope만 사용합니다. 관리자 시트 동의는 현재 코드의 `spreadsheets.readonly`,
`drive.metadata.readonly`, `drive.file`을 요청합니다. `drive.file`은 파일 쓰기 능력을 포함하므로
동의 권한 전체를 "읽기 전용"이라고 설명해서는 안 됩니다. 실제 앱은 Sheets 읽기와 Drive
watch 생성/중지만 호출합니다. 원본 미수정은 아래 별도 검증으로 확인합니다.

참고: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Google Drive 알림 등록](https://developers.google.com/workspace/drive/api/guides/push).

## 4. 최초 관리자: 일회성 감사 가능한 bootstrap

배포된 정확한 origin에서 첫 관리자가 Google 로그인을 한 번 시도합니다. Auth 사용자 생성 후
승인된 profile이 없어 앱 접근이 거부되는 것이 정상입니다. 운영자는 Supabase Auth에서
사용자 UUID·확인된 이메일·Google identity를 직접 대조하고 변경 승인/작업 번호를 남깁니다.
사용자 metadata의 role/organization을 신뢰하지 않습니다.

다음 SQL은 운영자 SQL Editor에서만 실행합니다. 모든 placeholder를 해당 환경에서 검토한
값으로 교체합니다. 신규 조직 UUID는 운영자가 생성·기록하고, 기존 조직이 있다면 일치 여부를
확인합니다. 앱 스키마에는 별도의 organizations 테이블이 없습니다. 이 절차는 해당 조직의
첫 관리자 전용이며 기존 profile/관리자를 덮어쓰지 않습니다.

```sql
begin;
do $bootstrap$
declare
  v_user uuid := '<verified Auth user UUID>';
  v_org uuid := '<reviewed organization UUID>';
  v_email text := '<verified Google email>';
  v_ticket text := '<approved change ticket>';
begin
  -- Serialize concurrent bootstrap attempts for the same organization.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));
  if not exists (
    select 1 from auth.users u
    where u.id = v_user and lower(u.email) = lower(v_email)
      and u.email_confirmed_at is not null
      and exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
  ) then raise exception 'verified_google_user_required'; end if;
  if exists (select 1 from public.profiles where id=v_user)
     or exists (select 1 from public.profiles where organization_id=v_org and role='admin')
  then raise exception 'bootstrap_already_done_or_profile_exists'; end if;
  insert into public.profiles(id, organization_id, role, display_name, is_active)
  values (v_user, v_org, 'admin', '관리자', true);
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, payload)
  values (v_org, v_user, 'admin_bootstrap', 'profile', v_user,
          jsonb_build_object('ticket', v_ticket, 'method', 'operator_sql_editor'));
end $bootstrap$;
commit;
```

에러이면 전체 transaction을 롤백하고 사용자/조직을 다시 확인합니다. 성공 후 profile의
`id, organization_id, role, is_active`와 `admin_bootstrap` 감사 이벤트를 확인해 작업 번호에
UTC 시각·대상 프로젝트·운영자·SQL revision·성공 여부만 기록합니다. Auth 토큰을 남기지
않습니다. 재로그인으로 관리자 진입을 확인하고 `/settings/users`에서 트레이너의 Google
이메일을 승인합니다. 이 초대는 메일을 발송하지 않으며 Google 로그인 때 claim됩니다.

## 5. Vercel 배포

Node.js 24, 저장소의 고정 pnpm 버전, Next.js framework, install 명령
`pnpm install --frozen-lockfile`, build 명령 `pnpm build`, 저장소 루트를 확인합니다.
Production 환경을 연결하기 전에 별도 Preview로 검증합니다.

```powershell
Get-Command vercel -ErrorAction SilentlyContinue
# CLI가 설치되어 있다면 인증된 계정/팀을 읽기 전용으로 확인
vercel whoami
vercel link
# Project Settings에서 Preview용 변수만 입력한 뒤
vercel deploy . -y
```

CLI가 없거나 인증되지 않았다면 설치된 Vercel deploy 스킬의 `scripts/deploy.sh` fallback을
시도합니다. 2026-09-10 실제 시도에서는 endpoint가 CLI 사용/로그인 안내만 반환했으며
`previewUrl`/`claimUrl`이 없어 script가 exit 1로 종료되었습니다. 현재 이 fallback으로 배포가
완료되지 않았으므로 운영자의 인증된 Vercel CLI가 필요합니다. 소스만 포함된 staging 디렉터리를 사용하고 `.env*`,
`.git`, `.next`, `node_modules`, 인증 상태, 로그, 스크린샷과 내부 작업 메모를 업로드하지 않습니다.
운영 환경변수 없이 만든 Preview는 `/demo` 확인용 UI/데모 미리보기이며 실제 로그인이
구성되지 않았습니다. Preview URL과 별도 claim URL은 배포 결과에서만 기록합니다.
Claim URL은 배포 관리 권한을 넘기는 링크이므로 공개 README에 게시하지 않습니다.

`vercel.json`은 `/api/cron/reconcile-sheets`에 `*/5 * * * *`를 등록합니다.
Vercel Hobby는 하루 한 번 cron만 지원하며 더 잦은 표현식은 배포에서 거부될 수 있습니다.
5분 cron을 지원하는 기존 요금제 또는 운영자가 승인한 별도 스케줄러가 필요합니다.
주기를 하루로 낮춘 상태를 5분 재조정 요구 충족으로 처리하지 않습니다.
[Vercel cron 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing).

운영 배포 권한과 인수 조건이 충족된 경우에만, 운영자가 Production 변수와 canonical 도메인을
설정한 뒤 실행합니다. 새 origin으로 바뀌면 OAuth/allowlist도 함께 맞춥니다.

```powershell
vercel deploy . --prod -y
```

immutable deployment URL, production domain, Git SHA, 환경변수 이름 목록(값 제외), migration
목록, 빌드 결과와 배포 시각을 운영 기록에 남깁니다. Vercel의 Ready 상태는 빌드 성공을
의미하며 아래 실제 연동 인수 통과를 의미하지 않습니다. Preview에서는 예약 cron이 자동
운영된다고 가정하지 말고, 전용 검증 환경에서 인증된 수동 reconciliation을 실행합니다.

## 6. 초기 가져오기, Drive watch, cron

관리자로 `/settings/sheets`의 Google 연결을 눌러 별도 동의를 완료합니다. 관리자는 원본
시트에 접근 가능해야 합니다. 세 시트 URL을 각각 추가하고 가능한 경우 담당 트레이너를
명시합니다. 미확인 담당자 이름/중복 이름은 검수 대상으로 남기며 트레이너 권한을 주지 않습니다.

연결 API는 connection/tab과 초기 pending job을 저장합니다. 연결 성공 응답만으로 import나
watch 등록이 끝난 것은 아닙니다. 인증된 reconciliation을 실행하면 pending import를 실행하고
없는 watch를 등록합니다. UI의 수동 동기화는 import를 실행하지만 watch 등록을 대신하지 않습니다.
Google 콜백/Drive가 접근할 HTTPS endpoint `/api/google/notifications`는 로그인, Vercel
Deployment Protection 또는 봇 challenge에 막히면 안 됩니다. 앱의 HMAC 검증은 유지합니다.

아래 호출은 해당 환경의 승인된 동기화 작업을 실행합니다. 운영자 비밀 관리자에서 이미
프로세스에 주입한 `CRON_SECRET`을 사용하며 콘솔에 값을 출력하지 않습니다.

```powershell
if (-not $env:CRON_SECRET -or -not $env:NEXT_PUBLIC_APP_URL) { throw 'Missing environment configuration' }
$reconcileUri = $env:NEXT_PUBLIC_APP_URL.TrimEnd('/') + '/api/cron/reconcile-sheets'
Invoke-RestMethod -Method Get -Uri $reconcileUri -Headers @{ Authorization = 'Bearer ' + $env:CRON_SECRET }
```

응답의 `synced`, `renewed`, `failed` 수를 기록하고 `failed=0`을 확인합니다. 인증 누락은
configured 환경에서 401, cron 비밀 미설정은 503이어야 합니다. Google은 파일 변경 알림을
보내고 서버가 시트를 다시 읽습니다. 알림에는 전체 시트 데이터가 오지 않습니다. 코드가
24시간 watch를 요청하고 재조정으로 갱신하므로 실제 반환 `expires_at` 및 갱신 기록을 봅니다.
알림은 누락될 수 있으므로 webhook 성공만으로 cron 확인을 생략하지 않습니다.

운영 SQL Editor에서 아래 메타데이터만 확인합니다. 별표 `select *`로 원본/토큰을 출력하지 마세요.

```sql
select id, status, is_active, last_successful_sync_at, last_error_code,
       watch_channel_id, watch_expires_at, last_message_number
from public.sheet_connections where organization_id='<organization UUID>';

select w.channel_id, w.source_connection_id, w.resource_id, w.expires_at,
       w.last_message_number, w.stopped_at
from public.sync_watches w join public.sheet_connections c on c.id=w.source_connection_id
where c.organization_id='<organization UUID>' order by w.created_at desc;

select source_connection_id, reason, status, attempts, started_at, completed_at,
       error_code, next_retry_at
from public.sync_jobs where organization_id='<organization UUID>'
order by created_at desc limit 100;
```

세 connection 모두 최근 `succeeded`, 유효한 current watch와 resource ID, 미래 만료 시각을
가져야 합니다. watch ID는 connection의 current channel과 대조합니다. 원본 변경 후 message
cursor 전진, notification job의 성공, 자동 dashboard 새로고침을 확인합니다. Vercel function
logs에서 callback 오류 유무, 알림 204, cron 200과 실행 주기를 확인하되 요청 Cookie,
Authorization, Google channel token이나 OAuth code/query string은 증거에 저장하지 않습니다.
5분 cron 두 번 이상과 watch 갱신 구간의 성공을 기록합니다. 처리량이 커지면 300초 function
한도 내에서 모든 후보가 완료되는지 별도 부하 검증이 필요합니다.

## 7. 실환경 인수: 세 시트, 권한 격리, 원본 미수정

권한을 받은 검증용 실제 Google Sheets 세 개를 사용합니다. 서로 다른 헤더 위치·열 순서·
헤더 동의어를 사용하고, 회원/등록/상담/수업을 포함한 수기 기대값을 준비합니다. 테스트 개인
정보를 넣지 않습니다. 각 시트마다 다음 결과를 pass/fail/blocked와 UTC 시각으로 기록합니다.

| 검사 | 실제 동작과 기대 결과 |
| --- | --- |
| 초기 import | 탭·헤더 발견, 필요 매핑 확인 후 회원수/금액/날짜/횟수가 수기 기대값과 일치 |
| 값 편집 | 원본 한 값을 사용자가 변경; 자동 refresh 후 해당 값과 집계 반영, 중복 canonical 기록 없음 |
| 열 재배치 | 기존 열 이동 후 같은 필드로 인식, 잘못된 금액/담당자 매핑 없음 |
| 새 열 | 관련 없는 열 추가 후 기존 기록 정상 유지, 새 필드는 자동 확정하지 않고 검수 여부 확인 |
| 알려진 동의어 | 알려진 헤더 동의어로 변경 후 계속 동기화; 모호해지면 검수 표시 확인 후 재확정 |
| 오류/복구 | 검증 시트 접근을 잠시 해제해 안전한 오류·마지막 데이터 유지 확인, 복원 후 재동기화 |
| 멱등성 | 같은 데이터를 다시 sync해 회원·등록/매출 중복과 금액 이중 합산 없음 |
| 반응형 | 실제 로그인한 관리자/트레이너를 1440px·390px에서 사용, 필터·표·설정·복구 동작 확인 |

트레이너 A/B를 같은 조직에 승인하고 각각 본인 소유인 알려진 회원과 등록을 준비합니다.
다른 조직의 관리자/트레이너도 별도 검증 환경에 준비합니다. fresh Google 로그인과 HttpOnly,
Secure, SameSite 쿠키·토큰 갱신 절차는 [브라우저 QA](browser-qa.md)의 마지막 gate를 따릅니다.

트레이너 A 세션에서 `/members`, `/registrations`, `/dashboard`가 자기 자료만 보여야 합니다.
이 앱에는 `/api/members` 또는 `/api/revenue` 라우트가 없습니다. 회원/매출의 실제 데이터
endpoint는 Supabase PostgREST의 `members`/`registrations`이며 RLS를 직접 확인해야 합니다.
트레이너 A의 실제 단기 access token과 공개 anon key를 쓰는 격리된 요청 도구에서 아래
GET을 실행합니다. 서비스 역할 키를 사용하면 이 검사가 무효입니다. 토큰/세션 파일은
저장소 밖에 두고 trace/HAR에 기록하지 않습니다.

```text
GET <SUPABASE_URL>/rest/v1/members?select=id&trainer_id=eq.<trainer-B-UUID>
GET <SUPABASE_URL>/rest/v1/registrations?select=id&trainer_id=eq.<trainer-B-UUID>
GET <SUPABASE_URL>/rest/v1/members?select=id&organization_id=eq.<other-org-UUID>
GET <SUPABASE_URL>/rest/v1/registrations?select=id&organization_id=eq.<other-org-UUID>
Headers: apikey: <public anon key>; Authorization: Bearer <trainer A short-lived token>
Expected: HTTP 200 with [] for each; own trainer queries return known rows.
```

트레이너 B 세션으로 역할을 바꿔 반복합니다. `sales_trainer_id`만 일치하는 타인 등록도
보이면 안 됩니다. 관리자 설정 진입은 dashboard로 redirect, `/api/trainers`와 `/api/review/...`
변경은 거부되어야 합니다. 비활성/미승인 계정과 익명 계정은 업무 데이터 접근이 거부되어야
합니다. 관리자도 타 조직 데이터를 볼 수 없어야 합니다. Realtime의 다른 조직/트레이너
채널 구독과 token 만료 후 refresh도 확인합니다.

원본 미수정 검증은 사용자 테스트 편집 직후를 기준으로 수행합니다. 세 시트 각각의 값과
수식(`FORMULA` 표현 또는 Google UI 수식 보기), revision/version history를 안전한 검증
저장소에 비교용으로 기록합니다. 자동 동기화, 관리자 검수/필드 수정, mapping 재확정,
재동기화를 실행한 뒤 원본 값·수식·열 구조가 그대로인지 비교합니다. 앱에 의해 생성된 원본
수정 revision이 없어야 합니다. Google API 사용 기록 또는 검증 transport에서는
Sheets `get`/`values.get`, Drive `files.watch`/`channels.stop` 외 쓰기 요청이 없는지 확인합니다.
특히 Sheets `values.update/append/clear/batchUpdate`, `spreadsheets.batchUpdate`나 Drive
파일 update/delete가 없어야 합니다. OAuth scope만 보고 원본 미수정 통과로 판정하지 마세요.

## 8. 브라우저 검증 및 출시 기록

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm exec playwright install chromium
pnpm exec playwright test
```

기본 local suite는 demo·로그인·익명 보호를 검증합니다. 운영 URL에 안전한 읽기 중심 smoke를
실행할 때는 앱 origin을 Playwright 설정이 실제 읽는 `E2E_BASE_URL`에 매핑합니다.
아래 suite는 실계정 인수 테스트가 아니라 비인증 UI smoke입니다.

```powershell
$env:E2E_BASE_URL = $env:NEXT_PUBLIC_APP_URL
pnpm exec playwright test --project=chromium --grep-invert 'deployment prerequisite:'
```

현재 이름이 `smoke`인 Playwright project는 없고 `chromium` 하나입니다. 세 조건부 live 테스트는
실제 세션이 필요하고, 그중 관리자 연결/오류 복구는 가짜 spreadsheet ID와 로컬 Google
transport fixture를 사용합니다. 이를 운영 URL에 실행하지 않습니다. 전용 검증 환경에서
[browser-qa.md](browser-qa.md)의 별도 명령으로 실행하고, 실제 Google은 위 수동 세 시트
gate로 검증합니다. skipped는 passed가 아닙니다. 배포 스킬로 생성한 Preview는 스킬의
검증 제한을 따르며 자동으로 원격 smoke를 실행하지 않습니다.

출시 기록은 다음을 포함합니다: 배포 SHA/immutable URL/운영 도메인, 마이그레이션 목록,
RLS 실제 SQL 결과, bootstrap 감사 번호, 세 시트별 검사 결과, 트레이너/조직별 endpoint
결과(행수만), 실제 로그인·모바일·Realtime token 갱신 결과, webhook/cron/watch 갱신 시각,
원본 값·수식 비교 결과, rollback 대상, 잔여 오류. 개인정보·원본 데이터·토큰은 제외합니다.
[security-review.md](security-review.md)의 rate/payload 제한·CSP 등 남은 운영 항목을 해소하거나
운영 책임자의 명시적 수용을 기록해야 합니다. 미완료 gate가 있으면 "운영 인수 대기"입니다.

## 9. 장애 대응과 롤백

1. 실패한 배포 SHA와 메타데이터를 보존합니다. 필요 시 운영자가 cron을 일시 정지하고
   `/settings/data-review`에서 영향받는 연결을 해제합니다. 연결 해제는 감사 기록을 남기며
   canonical 데이터는 유지합니다. 원본 history 삭제 기능은 롤백 수단이 아닙니다.
2. Vercel Deployments에서 검증된 이전 immutable 배포를 선택해 rollback합니다. 현재
   데이터베이스 스키마와 호환되는지 먼저 확인합니다. 도메인, OAuth URI, 암호화 키/환경변수
   버전이 이전 배포와 맞아야 합니다. 새 정식 변수만 쓰고 있다면 이전 코드 rollback 전에
   해당 버전이 읽는 legacy alias도 비밀 관리자에서 설정하고 재배포해야 할 수 있습니다.
3. 앱 rollback은 Supabase 마이그레이션과 이미 승인한 데이터를 되돌리지 않습니다. forward
   fix migration을 검증 프로젝트에서 먼저 시험합니다. 백업 복원은 복구 지점 이후의 변경을
   잃을 수 있으므로 별도 운영 승인 및 복구 절차로 실행합니다. RLS를 끄거나 운영 reset을
   실행해 임시 복구하지 않습니다.
4. Google notification secret을 교체하면 기존 채널 token은 새 검증 값과 맞지 않습니다.
   계획된 채널 재등록/만료 및 cron 복구를 확인합니다. 암호화 키는 이전 키 없이는 복원이
   불가능하므로 백업을 보존하고 관리자 재동의 여부를 결정합니다. 노출된 service-role/
   OAuth/cron 자격 증명은 제공자에서 회수/교체하고 관련 세션 만료를 검증합니다.
5. 문제 연결을 재연결하고 인증된 reconciliation으로 import/watch를 복구합니다. cron을
   재개한 뒤 5분 주기, 최근 성공 시각, 타인 데이터 차단과 원본 미수정을 재검증합니다.

참고: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).
