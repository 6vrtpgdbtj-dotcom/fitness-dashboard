# Design Brief

## Product job

An administrator connects changing Google Sheets and trainers inspect their own members and performance, so the branch can act on reliable current data without replacing the team's existing workflow.

## Direction

A dense athletic operations cockpit: asymmetric data story, warm-black utility rail, lime only for live state and decisive comparisons, and task-first mobile reordering.

## Brand reading

- Immutable identity: 1986 FITNESS, Jung-san branch, direct Korean operational language.
- Repeatable shapes/materials: compact dark rails, flat data surfaces, clipped chart bands, restrained 6–8px radii.
- Existing inconsistencies to remove: equal-card dashboard grids and decorative status pills.
- Media provenance: no external photography or invented logo; use typographic `86` mark until owned CI assets are supplied.

## Reference evidence

- Approved local mockup: `C:/Users/정윤수/.codex/visualizations/2026/09/05/01a0718a-d068-7182-ad6e-81f3b5f020b0/fitness-dashboard-mockup.html`, desktop operational dashboard, inspected again in a browser on 2026-09-08; capture `output/playwright/task-7-reference.png`. Adapt the dark navigation rail, live-sync module, asymmetric chart/funnel composition, and renewal queue. Do not treat its sample metrics as production facts.
- Motion React animation reference: https://motion.dev/docs/react-animation, opened 2026-09-08. Inspected initial/animate targets, variants propagation, orchestration and gesture states. Adapt coordinated metric/chart entrance and hover/focus feedback; avoid perpetual or scroll spectacle.
- Tremor bar chart reference: https://www.tremor.so/docs/visualizations/bar-chart, opened 2026-09-08. Inspected grouped comparison, category labels, legend and selected-value anatomy. Adapt grouped new/renewed comparison and a compact persistent readout; do not copy default colors or container styling. The local chart uses typed data and Motion directly, without adding a chart framework.

## Reference synthesis

- Structure comes from: the approved local operations mockup.
- Interaction comes from: Motion variants and accessible native controls.
- Visual tone comes from: 1986 FITNESS charcoal/lime direction in the approved mockup.
- Hook/copy energy comes from: immediate branch status and the next operational action, not marketing copy.
- Motion/media behavior comes from: Motion coordinated variants and chart state transitions.
- The final screen will not copy: proprietary wording, third-party brand marks, default Tremor theme, or fabricated member facts.

## Reference implementation map

| Reference evidence | Extracted principle | Local component | Motion/state | Mobile translation | Acceptance evidence |
|---|---|---|---|---|---|
| Approved mockup sidebar and sync block | Connection health is persistent but secondary | `src/components/app-shell.tsx`, `src/components/dashboard/sync-pulse.tsx` | timestamp-keyed one-shot pulse; partial failure keeps successful data visible | administrator sync module moves above today's work; trainer has no connection module | `output/playwright/task-7-admin-1440.png`, `task-7-admin-390.png`, `task-7-state-partial.png` |
| Approved mockup revenue + funnel split | Largest area answers revenue trend; funnel is adjacent context | `src/components/dashboard/revenue-chart.tsx`, `conversion-funnel.tsx` | linked period/trainer selection and grouped chart draw | today, metrics and renewal queue precede the revenue chart and funnel | `output/playwright/task-7-admin-1440-full.png`, `task-7-trainer-390-full.png` |
| Motion variants guide | Parent coordinates child reveals | `src/components/dashboard/dashboard-motion.tsx` | metrics settle first, then chart marks | stable server/client initial targets; CSS immediately exposes final state under reduced motion | `output/playwright/task-7-motion.webm`, `task-7-motion-1.png` through `task-7-motion-7-accessible-table.png`, `task-7-reduced-motion.png` |
| Tremor bar-chart anatomy | Direct categories, grouped series, compact readout | `src/components/dashboard/revenue-chart.tsx` | selected month emphasizes both bars; accessible values remain available in a table | compact labels; alternate month labels hidden when more than eight months; touch/keyboard selection | `output/playwright/task-7-trainer-390-full.png`, `task-7-motion-7-accessible-table.png`; chart component tests |

## Signature composition and component

- Signature composition: a narrow live-operations rail beside an asymmetric revenue story and renewal action queue, rather than an equal-card admin grid.
- Signature component: `SyncPulse`, combining connection count, latest refresh, partial-failure state, and a compact activity line without exposing raw errors.

## Motion storyboard

| Beat | Trigger | Elements | From → to | Duration/ease | Purpose | Reduced motion |
|---|---|---|---|---|---|---|
| Establish current state | dashboard load | metric values then chart bars | y 8/opacity 0 → settled | 220ms then 320ms ease-out | lead from summary to evidence | render final state immediately |
| Reveal sync result | sync job completes | SyncPulse dot, timestamp, connection health line | neutral → pulse → stable | 420ms ease-out | confirm fresh data | text and icon state change only |
| Filter comparison | period/trainer selection | bars, totals, renewal rows | old geometry → new geometry | 260ms ease-in-out | preserve comparison context | update instantly |
| Hover/focus feedback | pointer or keyboard | nav, row, chart target | surface/translate 0 → emphasized | 140ms ease-out | show interactivity | color/focus ring only |

## Tokens

- Font: Pretendard Variable for Korean UI; Archivo for brand and tabular primary metrics.
- Font verification: browser computed styles and `document.fonts.check` confirmed both project fonts loaded at all tested widths. Gmarket Sans was not selected: its classroom tone does not match the compact athletic operational direction.
- Text colors: warm off-white primary, sage-gray secondary, high-contrast dark text in light mode.
- Surface colors: warm black shell, charcoal rail, neutral raised data surface.
- Accent and semantic colors: electric lime for live/selected, amber for review, red for failure, blue only for neutral information.
- Spacing steps: 4, 8, 12, 16, 24, 32px.
- Radius: 6px controls, 8px panels; circular only for status dots and avatars.
- Border and shadow: 1px low-contrast borders; shadows only for dialogs.
- Motion: 140ms interaction, 220–320ms content transition, 420ms one-shot sync pulse.

## Copy ladder

- Context: `중산점 운영 현황`
- Primary action: `Google 시트 연결`
- Proof: last successful sync and normalized record counts.
- Recovery: exact affected sheet and retry state, without technical stack traces.

## Screen priorities

1. Is the data current and what needs attention now?
2. How are revenue, registrations, consultations, and classes changing?
3. Which members need renewal action and which source needs review?

## Behavior that must remain unchanged

- Source Sheets remain read-only.
- Trainers never authorize Google and never see other trainers' data.
- One failed source never blocks healthy connections.

## Anti-template decisions

- Generic pattern being rejected: uniform KPI cards followed by unrelated boxed charts.
- Project-specific replacement: live-operations rail, asymmetric revenue/funnel story, and renewal queue tied to sheet freshness.

## Responsive and motion contract

- Viewports: 320 / 360 / 390 / 430 / desktop.
- Mobile reorders sync health, today's work, renewal queue, then trends; navigation becomes a five-action bottom bar.
- Reduced-motion final state: no entrance stagger, no pulse scaling, immediate chart geometry with semantic text updates retained.

## Verification captures

- Desktop first viewport at 1440×900.
- Trainer mobile first viewport at 390×844.
- Administrator empty connection state.
- Partial sync failure state with healthy data retained.
- Sequential dashboard load and successful sync captures.

## Applied verification — 2026-09-08

- Production build: `pnpm build` exits 0. Full regression: `pnpm vitest run` passes 194 tests in 23 files. `pnpm lint`, standalone TypeScript check and `git diff --check` pass.
- Browser QA used the production server and the explicit `/demo` route. Every sample screen is visibly labeled as fictional, and production queries never import the sample fixture.
- Administrator and trainer layouts: 320, 360, 390, 430 and 1440px; document width exactly matches the viewport at all ten combinations. Pretendard Variable and Archivo are loaded. Production browser checks reported zero errors.
- Mobile transformation verified by actual element positions: at 390px the administrator order is sync → today → metrics → renewal → revenue; trainer is today → metrics → renewal → revenue. Navigation becomes five 52px-minimum-height controls.
- Empty, normal, loading, error and partial-sync-failure captures are in `output/playwright/task-7-state-*.png`. The partial state identifies the affected source while preserving the successful data and timestamp.
- Motion proof: `output/playwright/task-7-motion.webm` and sequential captures. At approximately 210ms metric opacity was 0 and chart scaleY was 0; at 418ms metric opacity was 0.999 while chart scaleY was still 0; by 758ms both reached final geometry. SyncPulse scale changed 1.020 → 1.476 → 1. The linked trainer selection changed sample revenue to 15,920,000 and the keyboard-accessible chart table opened.
- Reduced-motion QA: final chart bars visible, no transform animation and no hydration errors. Stable initial render properties plus CSS final-state rules also preserve visibility before hydration.
- Real production behavior: verified `requireUser` scope, valid-only paginated reads, organization/trainer private-channel RLS execution, minimal success broadcasts, debounce/unsubscribe and all prior auth/sync regression tests.
- Remaining environment validation: no live Supabase/Google credentials were present, so a real authenticated sync-to-browser session has not been exercised. Apply the new realtime migration and validate the private channel with the deployed project.
- Human visual review: desktop flow, trainer mobile and partial state inspected after automated checks. Anti-template gate passes: continuous unequal metric strip, asymmetric revenue/funnel composition, persistent source-health rail and a member action queue. Rubric: 51/54; dense supporting labels, supplied-CI limitations and unavailable live external integration each retain one point of follow-up scope.
