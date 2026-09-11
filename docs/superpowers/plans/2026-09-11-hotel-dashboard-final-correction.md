# Hotel Dashboard Final Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 매출시트의 계층형 담당자 구조를 정확히 읽고 팀 매출을 보존하면서 새 트레이너를 자동 연결하며, 수업 정렬과 호텔형 대시보드까지 실사용 상태로 배포한다.

**Architecture:** Google Sheets 전처리는 상위 트레이너 블록을 명시적인 행별 힌트로 평탄화하고, Supabase는 재무 행의 유효성과 개인 담당자 연결을 분리한다. 분석 계층은 팀 전체와 활성 트레이너 개인 범위를 따로 계산하며, UI는 이 결과를 PT 원장 중심의 비대칭 구성으로 표현한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase/PostgreSQL, Google Sheets API, Motion, Vitest/PGlite, Playwright, Vercel

**Spec:** `docs/superpowers/specs/2026-09-11-hotel-operations-dashboard-design.md`

## Global Constraints

- 모든 시트 접근은 읽기 전용이며 원본 값을 수정하지 않는다.
- 날짜·시간과 당일 판정은 `Asia/Seoul` 기준이다.
- 담당자가 없거나 아직 등록되지 않은 PT/FC 유효 매출도 팀 합계에서 제외하지 않는다.
- 개인 데이터는 활성 트레이너의 이름 또는 이메일과 유일하게 일치할 때만 연결한다.
- 원본에 없는 신규·재등록·필드·OT·상담 분류를 임의 생성하지 않는다.
- 390px에서 문서 가로 스크롤, 한국어 겹침, 44px 미만의 핵심 조작 영역이 없어야 한다.
- 새 의존성을 추가하지 않고 현재 Motion 및 테스트 도구를 사용한다.

---

### Task 1: 실제 매출시트 계층형 담당자 블록 파싱

**Files:**
- Modify: `src/features/sync/sheet-pipeline.ts`
- Test: `src/features/sync/__tests__/repository.test.ts`

**Interfaces:**
- Consumes: `extractRepeatedTables(rows, "registration", tabTitle)`의 기존 반환 형식.
- Produces: 평탄화된 `담당트레이너` 또는 `판매트레이너` 값. 상위 제목은 다음 명확한 트레이너/섹션 경계 전까지 상속된다.

- [ ] **Step 1: 상위 트레이너 제목 아래 안내 머리글을 재현하는 실패 테스트 작성**

```ts
it("inherits a trainer section title through 담당자 배정 subheaders", () => {
  const rows = [
    ["PT 매출"],
    ["", "정윤수"],
    ["날짜", "회원명", "매출", "RE/NEW", "담당자 배정", "유입경로"],
    ["8/3", "김회원", "1,100,000", "NEW", "", "OT"],
  ];
  expect(extractRepeatedTables(rows, "registration", "26.8")).toContainEqual([
    "김회원", "2026-08-03", "1,100,000", "NEW", "정윤수", "", "OT", "", "PT 회원권", "결제완료",
  ]);
});
```

- [ ] **Step 2: 테스트가 현재 실패함을 확인**

Run: `pnpm vitest run src/features/sync/__tests__/repository.test.ts`
Expected: 해당 행의 담당트레이너가 빈 문자열이어서 FAIL.

- [ ] **Step 3: 열 블록별 상위 트레이너 탐색과 경계 상속 구현**

`extractRepeatedTables`의 월별 등록 분기에서 헤더 위 행을 열 블록 범위로 검사한다. `/^[가-힣]{2,6}$/` 후보 중 필드 라벨(`담당자`, `담당자 배정`, `회원명`, `구분`)을 제외해 `sectionTrainer`를 구하고, 직접 입력된 담당자 값이 없을 때만 사용한다. 다음 marker 또는 새 트레이너 제목이 경계다.

```ts
const trainerLabel = /^(담당자(?:\s*배정)?|회원명|구분|유입경로)$/;
const sectionTrainer = markerRows
  .flatMap((row) => row.slice(marker.start, end))
  .map((cell) => String(cell ?? "").trim())
  .findLast((text) => /^[가-힣]{2,6}$/.test(text) && !trainerLabel.test(text));
const assignedTrainer = trainer >= 0 && String(row[trainer] ?? "").trim()
  ? row[trainer]
  : sectionTrainer ?? "";
```

- [ ] **Step 4: 직접 입력 담당자가 상위 제목보다 우선하고 충돌 블록이 섞이지 않는 테스트 추가**

```ts
expect(extracted).toEqual(expect.arrayContaining([
  expect.arrayContaining(["김회원", "2026-08-03", "100,000", "NEW", "박세준"]),
  expect.arrayContaining(["이회원", "2026-08-04", "200,000", "RE", "정윤수"]),
]));
```

- [ ] **Step 5: 파서 테스트 및 타입 검사 후 커밋**

Run: `pnpm vitest run src/features/sync/__tests__/repository.test.ts && pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add src/features/sync/sheet-pipeline.ts src/features/sync/__tests__/repository.test.ts
git commit -m "fix: inherit trainer sales sections"
```

### Task 2: 팀 매출 보존 및 새 트레이너 과거 기록 자동 연결

**Files:**
- Create: `supabase/migrations/202609110001_preserve_team_revenue_assignment.sql`
- Modify: `src/features/admin/__tests__/database.test.ts`

**Interfaces:**
- Consumes: `sync_record_state.record.hints.sales_trainer_name`, `.trainer_name`, `public.admin_trainer(jsonb)`.
- Produces: `private.apply_admin_assignment()`이 유효 상태를 보존하고 유일 매칭만 `trainer_id`에 기록한다. invite/activate 후 해당 조직의 column-mode 기록을 replay한다.

- [ ] **Step 1: 미배정 PT/FC가 valid로 남고 팀 매출에 포함되는 실패 테스트 작성**

```ts
expect((await db.query("select product,trainer_id,record_status from registrations order by product")).rows).toEqual([
  { product: "FC 12개월", trainer_id: null, record_status: "valid" },
  { product: "PT 20회", trainer_id: null, record_status: "valid" },
]);
```

- [ ] **Step 2: 새 트레이너 초대가 과거 힌트를 재배정하는 실패 테스트 작성**

```ts
await call("admin_trainer", [{ action:"invite", email:"new@example.com", displayName:"정윤수", active:true }]);
expect((await db.query("select trainer_id,record_status from registrations where source_record_key='past-sale'")).rows[0])
  .toMatchObject({ trainer_id: expect.any(String), record_status:"valid" });
```

- [ ] **Step 3: DB 테스트가 현재 실패함을 확인**

Run: `pnpm vitest run src/features/admin/__tests__/database.test.ts`
Expected: 미일치 PT가 `review_required`이거나 invite 뒤 trainer_id가 null이라 FAIL.

- [ ] **Step 4: 유효성과 담당자 연결을 분리하는 마이그레이션 구현**

```sql
if v_mode='column' then
  v_trainer_hint:=coalesce(nullif(new.record#>>'{hints,sales_trainer_name}',''),
                            nullif(new.record#>>'{hints,trainer_name}',''));
  select count(*),(array_agg(id))[1] into v_count,v_trainer
  from public.trainers
  where organization_id=new.organization_id and is_active
    and (lower(trim(display_name))=lower(trim(v_trainer_hint))
      or lower(email)=lower(trim(v_trainer_hint)));
  execute format('update public.%I set trainer_id=$1,record_status=coalesce($2::public.record_review_status,record_status) where organization_id=$3 and source_connection_id=$4 and source_tab_id=$5 and source_record_key=$6',v_table)
    using case when v_count=1 then v_trainer else null end,
      new.record->>'record_status',new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key;
end if;
```

`admin_trainer`의 invite 및 `active=true` 성공 뒤 아래 replay를 수행한다.

```sql
update public.sync_record_state s set record=s.record
where s.organization_id=v_org
  and exists (select 1 from public.sheet_connections c
    where c.id=s.source_connection_id and c.organization_id=v_org
      and c.trainer_assignment_mode='column');
```

- [ ] **Step 5: 비활성화 시 팀 매출은 유지하고 개인 연결만 제거되는 회귀 테스트 추가**

- [ ] **Step 6: DB 테스트 후 커밋**

Run: `pnpm vitest run src/features/admin/__tests__/database.test.ts src/features/analytics/__tests__/queries.test.ts`
Expected: PASS.

```bash
git add supabase/migrations/202609110001_preserve_team_revenue_assignment.sql src/features/admin/__tests__/database.test.ts
git commit -m "fix: preserve revenue during trainer assignment"
```

### Task 3: 한국시간 수업 정렬과 원문 회원명 보존

**Files:**
- Create: `src/components/dashboard/class-order.ts`
- Create: `src/components/dashboard/__tests__/class-order.test.ts`
- Modify: `src/components/dashboard/today-classes.tsx`
- Modify: `src/components/dashboard/detail-view.tsx`

**Interfaces:**
- Produces: `sortTodayClasses(rows: ClassRow[]): ClassRow[]`와 `sortPeriodClasses(rows: ClassRow[]): ClassRow[]`.

- [ ] **Step 1: 시간 미정은 마지막, 동일 날짜는 이른 시간 우선인 실패 테스트 작성**

```ts
expect(sortTodayClasses([unknown, tenThirty, nine])).toEqual([nine, tenThirty, unknown]);
expect(sortPeriodClasses([olderNine, newerEleven, newerEight])).toEqual([newerEight, newerEleven, olderNine]);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/components/dashboard/__tests__/class-order.test.ts`
Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 안정적인 정렬 키 구현**

```ts
const timeKey = (row: ClassRow) => row.starts_at ? Date.parse(row.starts_at) : Number.MAX_SAFE_INTEGER;
export const sortTodayClasses = (rows: ClassRow[]) => [...rows].sort((a,b) => timeKey(a)-timeKey(b));
export const sortPeriodClasses = (rows: ClassRow[]) => [...rows].sort((a,b) =>
  (b.class_date ?? "").localeCompare(a.class_date ?? "") || timeKey(a)-timeKey(b));
```

- [ ] **Step 4: 두 화면이 공통 정렬기를 사용하고 schedule ID의 회원명을 fallback으로 표시하게 변경**

- [ ] **Step 5: 테스트 및 커밋**

Run: `pnpm vitest run src/components/dashboard src/features/analytics/__tests__/queries.test.ts`
Expected: PASS.

```bash
git add src/components/dashboard
git commit -m "fix: order classes by Korean schedule time"
```

### Task 4: PT Revenue Ledger 중심 정보 구조

**Files:**
- Create: `src/components/dashboard/pt-revenue-ledger.tsx`
- Create: `src/components/dashboard/__tests__/pt-revenue-ledger.test.tsx`
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Modify: `src/components/dashboard/revenue-chart.tsx`

**Interfaces:**
- Consumes: `DashboardData.metrics`, `.trainerComparison`, `.revenue`.
- Produces: 팀 PT 합계가 가장 크게 보이고 신규/재등록, 트레이너 기여, 실제 source 분류를 함께 탐색하는 접근 가능한 컴포넌트.

- [ ] **Step 1: 핵심 수치와 원본 분류 노출 실패 테스트 작성**

```tsx
render(<PtRevenueLedger data={fixture} />);
expect(screen.getByRole("heading", { name:/PT 팀 매출/ })).toBeVisible();
expect(screen.getByText("정윤수")).toBeVisible();
expect(screen.getByText("OT 매출")).toBeVisible();
expect(screen.getByText("재등록 매출")).toBeVisible();
```

- [ ] **Step 2: 실패 확인 후 시맨틱 ledger 구현**

팀 합계는 `metrics.periodRevenue`, 신규/재등록은 trainerComparison 합계, source 열은 실제 `sourceRevenue` 키의 합집합만 사용한다. 개인 선택은 기존 dashboard trainer filter와 연결하고 미배정액은 팀 합계와 개인 합계 차이로 명시한다.

- [ ] **Step 3: 기존 동일 크기 metric strip을 PT ledger + 보조 지표 열로 재구성**

- [ ] **Step 4: 접근성/분류 테스트 및 커밋**

Run: `pnpm vitest run src/components/dashboard src/features/analytics/__tests__/queries.test.ts`
Expected: PASS.

```bash
git add src/components/dashboard
git commit -m "feat: add PT revenue ledger"
```

### Task 5: 호텔 라운지형 시각 시스템과 모바일 변환

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/dashboard/dashboard-motion.tsx`
- Modify: `src/components/dashboard/today-classes.tsx`
- Modify: `src/components/dashboard/detail-view.tsx`
- Modify: `e2e/responsive-dashboard.spec.ts`

**Interfaces:**
- Consumes: `DESIGN_BRIEF.md` 토큰 및 Task 4 ledger DOM.
- Produces: 아이보리/차콜/브론즈 토큰, 비대칭 데스크톱 구성, 390px 작업 순서 변환, reduced-motion fallback.

- [ ] **Step 1: PT ledger 우선순위와 모바일 overflow 실패 검증 추가**

```ts
await expect(page.getByRole("heading", { name:/PT 팀 매출/ })).toBeInViewport();
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
```

- [ ] **Step 2: CSS 토큰을 브리프의 정확한 색·반경·간격으로 교체**

```css
:root {
  --surface-0:#f4efe6; --surface-1:#fffcf6; --ink:#24221f;
  --rail:#242421; --accent:#a97845; --accent-strong:#76502d;
  --radius-panel:6px; --motion-fast:140ms; --motion-layout:260ms;
}
```

- [ ] **Step 3: 데스크톱 비대칭 구성과 390px 순서 변환 구현**

PT ledger는 첫 데이터 행의 주영역, 차콜 운영 레일은 보조영역으로 둔다. 모바일은 PT→오늘 수업→재등록→개인 실적→추이로 순서를 바꾸고 상세 표는 핵심 열 중심의 행 카드로 변환한다.

- [ ] **Step 4: 순서형 모션과 세 가지 microinteraction 구현**

`dashboard-motion.tsx`의 variants로 PT 합계→분해→트레이너 행을 60ms 간격으로 연결하고, 내비/필터/표 행에 hover·focus-visible·selected 피드백을 적용한다. reduced motion이면 transition을 제거하고 최종 상태를 즉시 표시한다.

- [ ] **Step 5: 컴포넌트 테스트, e2e, 빌드 후 커밋**

Run: `pnpm vitest run src/components && pnpm playwright test e2e/responsive-dashboard.spec.ts && pnpm build`
Expected: PASS, 390px document scrollWidth가 viewport와 동일.

```bash
git add src/app/globals.css src/components e2e/responsive-dashboard.spec.ts DESIGN_BRIEF.md
git commit -m "feat: apply hotel operations design"
```

### Task 6: 실제 시트 대조, 전체 검증 및 배포

**Files:**
- Modify: `DESIGN_BRIEF.md`
- Modify: `docs/browser-qa.md`
- Modify only if evidence finds a defect: files from Tasks 1–5

**Interfaces:**
- Consumes: 연결된 세 매출/스케줄 시트, Supabase project, Vercel project.
- Produces: 실제 월별 PT/FC/개인 분류 대조표, 배포된 migration과 production URL, 캡처 증거.

- [ ] **Step 1: 연결된 실제 매출시트의 병합 범위·상위 제목·하위 헤더·PT/FC 경계를 읽고 익명 fixture와 결과를 대조**

검증 항목: 기간 총 PT, FC, 정윤수/박세준/이재승 개인 합계, 신규/재등록, 필드/OT/상담/워크인 등 실제 source 키, 상위 제목 아래 `담당자 배정` 행.

- [ ] **Step 2: 전체 자동화 검증**

Run: `pnpm vitest run --maxWorkers=2 && pnpm lint && pnpm exec tsc --noEmit && pnpm build && git diff --check`
Expected: 모두 exit 0.

- [ ] **Step 3: 프로덕션 빌드로 정상·0·미확인·부분 실패 및 1440/390 화면 확인**

Playwright로 첫 화면, 전체 화면, 수업 시간순, 키보드 포커스, reduced-motion, 5–10초 순차 모션을 캡처한다. 수치는 실제 시트와 월별로 대조한다.

- [ ] **Step 4: Supabase migration 적용 후 저장된 행 replay와 새 트레이너 시나리오 확인**

마이그레이션 적용 전 대상 project ref를 확인하고, 적용 후 미배정 팀 매출·개인 매칭·초대 뒤 과거 연결을 SQL 및 UI 양쪽에서 확인한다.

- [ ] **Step 5: 브리프 증거 갱신, 최종 커밋·push·Vercel 배포**

```bash
git add DESIGN_BRIEF.md docs/browser-qa.md
git commit -m "docs: record final dashboard verification"
git push origin codex/fitness-dashboard
```

배포 URL에서 같은 기간 수치, 한국시간, PT 우선 레이아웃, 새 트레이너 자동 연결을 다시 확인한다.

