# PT팀 · Google Sheets 운영 대시보드

회원·등록 매출·상담·수업을 Google Sheets에서 읽어 한국어 운영 화면으로 모읍니다.
Next.js 15 / React 19 / TypeScript, Supabase Auth·Postgres·RLS·Realtime을 사용합니다.
관리자는 시트 연결·매핑 확인·검수·트레이너 승인을 담당하고, 트레이너는 본인에게
배정된 유효 기록만 조회합니다. 관리자 수정은 데이터베이스에 저장되며 원본 시트로
역전송되지 않습니다.

## 실행

Node.js 24와 `package.json`에 고정된 pnpm 버전을 사용합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:3000/demo`는 환경변수 없이 볼 수 있는 가상 데이터 화면입니다.
`/demo?role=trainer`에서 트레이너 화면을 확인할 수 있습니다. 실제 로그인·시트 동기화·
권한 격리를 증명하는 화면은 아닙니다. 실제 연동에는 `.env.example`을 `.env.local`로
복사한 뒤 해당 환경의 Supabase·Google 설정이 필요합니다. 비밀 값은 커밋하지 않습니다.

## 배포와 검증

[운영 배포 절차](docs/deployment.md)에 환경변수의 생성 담당자, Supabase 마이그레이션,
최초 관리자 생성과 감사 기록, Google 콜백, Drive watch 등록, cron, 롤백,
세 시트 실연동 및 트레이너 격리 인수 검증을 정리했습니다. 환경변수의 정식 이름은
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_NOTIFICATION_SECRET`입니다.
이전 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_WATCH_SECRET`도
정식 값이 비어 있을 때만 호환됩니다. 새 설정에는 정식 이름을 사용하세요.

```powershell
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm exec playwright install chromium
pnpm exec playwright test
```

기본 브라우저 검증은 빌드한 서버를 3100 포트에서 실행합니다. 실제 Supabase 세션과
별도 테스트 환경이 필요한 세 테스트는 설정이 없으면 건너뜁니다. 건너뛴 테스트와
가상 화면 통과를 운영 인수 통과로 계산하지 마세요. 실환경 전에는
[브라우저 검증](docs/browser-qa.md), [RLS 검사](supabase/README.md),
[보안 검토의 잔여 운영 항목](docs/security-review.md)도 완료해야 합니다.

운영 자격 증명이 없는 Vercel URL은 UI/데모 미리보기입니다. 이 저장소의 배포 문서와
로컬 테스트만으로 Supabase 운영 구성, Google 동의, 실시간 동기화 또는 운영 준비 완료를
선언하지 않습니다. Hobby 배포에서는 Google Drive 알림이 실시간 갱신을 담당하고,
`vercel.json`의 하루 1회 cron은 알림 누락 복구용으로만 동작합니다.
