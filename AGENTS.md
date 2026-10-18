# The External Brain

React 19 + TypeScript + Vite client (GitHub Pages) on a Supabase Postgres backend, for Neuro Network UCSD.
`app/` is the client, `supabase/migrations/` is the schema and RLS, `docs/` holds plans and decisions.
Product and design context: `PRODUCT.md` and `DESIGN.md` at the repo root. Read them before UI work.

## Commands (from `app/` unless noted)

- Install: `npm ci`
- Dev server: `npm run dev`. With no `app/.env.local` the app runs a labeled local demo with fictional data. Use demo mode for all development.
- Build and typecheck: `npm run build`
- Tests: `npx vitest run src` (one file: `npx vitest run src/domain.test.ts`)
- Database and RLS: `node scripts/check-database.mjs` (applies every migration in PGlite and exercises the policies)
- Pages deploy guard (repo root): `node app/scripts/check-pages-config.mjs`
- Browser review: use the `verify-ui` skill.

## Definition of done

Build passes, the relevant tests pass, and for UI changes you have looked at the screenshots.
End every task by stating what you ran and what you checked. If you could not verify something, say so plainly. Never claim untested code works.

## Rules

- Logic changes (permissions, deadlines, HP, review cycles, imports) start with a failing test.
- Never delete, skip or weaken a test to make it pass. If a test looks wrong, stop and explain why before touching it.
- Migrations: add a new file in `supabase/migrations/` named `YYYYMMDDNNNN_short_name.sql`, numbered after the latest one. Never edit one that has been applied. Every new table gets RLS. Extend `check-database.mjs` for every new policy or RPC. The owner reviews all migration, RLS and auth changes before merge.
- Secrets: Vite env vars hold only the publishable or anon key. Never use or ask for a service-role or `sb_secret_` key. Never read or commit `app/.env.local`.
- No real member data, credentials or Notion exports in the repo. Use the fictional demo data in `src/demo.ts`.
- Size: keep files under about 800 lines. `src/App.tsx` (over 4,000 lines) is being split, so put new screens and components in their own files under `src/` instead of growing it.
- Reuse what exists (`domain.ts`, `model.ts`, `demo.ts`, existing CSS tokens) before adding abstractions. No new dependency without asking.
- Keep diffs small and on task: no drive-by refactors, no commented-out code, no speculative options or config.
- UI must work in dark and light themes, at 390px wide, and with reduced motion.
- Git: stage specific files. Never `git add -A` or `git add .`; the working tree often holds unrelated untracked files.

## Terms

Initiative, lead, member, Operations (admins), Roast Me (RM, plural RMs), HP, review cycle. Use these exact names in code and UI copy.
