# Task 1 report — application foundation and visual system

## Delivered

- Created the Next.js App Router TypeScript foundation with pnpm scripts, strict TypeScript, Vitest, Playwright configuration, ESLint, and the requested Supabase, Google Sheets, Zod, and server-only dependencies.
- Added `AppShell({ children, role, displayName })` with the full administrator navigation, restricted trainer navigation, desktop utility rail, accessible landmarks, and a five-action mobile bottom navigation below 768px.
- Added global surface, accent, text, border, success, warning, danger, and information tokens. The charcoal/warm-black/lime visual system follows `DESIGN_BRIEF.md`, with 6px controls, 8px panels, low-contrast borders, responsive spacing, focus states, and reduced-motion overrides.
- Added a shell page and root layout carrying Korean language metadata and 1986 FITNESS typographic identity.
- Added `.env.example` for Supabase and Google service-account variables.

## TDD evidence

1. Wrote `src/components/__tests__/app-shell.test.tsx` before `src/components/app-shell.tsx`.
2. Ran the required test against the missing component. It failed as expected with `Failed to resolve import "@/components/app-shell"`.
3. Implemented the smallest role-aware shell needed by the tests, then expanded styling and application scaffolding.
4. Re-ran the component test after implementation: 2 tests passed.

## Final verification

- `pnpm vitest run src/components/__tests__/app-shell.test.tsx` — 2/2 tests passed.
- `pnpm lint` — exit 0.
- `pnpm build` — exit 0; Next.js compiled, type-checked, and prerendered `/`.

## Note

`public/fonts/README.md` documents the two required licensed font filenames. CSS is already wired to self-hosted `PretendardVariable.woff2` and `Archivo-Variable.woff2`, but the binary font files were not present in the supplied repository and were not invented or downloaded without a verified license source.
