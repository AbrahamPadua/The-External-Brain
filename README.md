# The External Brain · Neuro Network UCSD

React/TypeScript client for GitHub Pages and a Supabase PostgreSQL backend. Account approval is separate from email verification and initiative participation. New sign-ups remain pending until Operations or Research approves them.

## Run locally

From `app/`: `npm ci`, then `npm run dev`. Without Supabase environment settings the app uses a visibly labeled, fictional local demo. Demo data is stored only in your browser and is never a production identity or permission system.

For live mode, copy `app/.env.example` to `app/.env.local` and set your Supabase project URL and **publishable/anon** key. Never use a service-role key in a Vite environment variable. Restart the development server after changes.

## Backend setup

1. Create an organization-owned Supabase project and apply every file in `supabase/migrations/` in filename order. The committed migration set is `001`–`025`. Later migrations supersede the initial policies and commands; do not stop at `007`. Migration `025` preserves the abstract on new proposal approvals, stores the execution plan separately, and adds `execution_plan` to the public catalog without rewriting existing initiatives.
2. Enable email magic-link authentication, configure production SMTP, and register the exact local/deployed redirect URL in Supabase Auth settings.
3. Sign up the initial Operations administrator. An organization owner then approves that user's UUID and grants the Operations role through the Supabase SQL editor; see `docs/BACKEND.md`. This is the only bootstrap exception to self-approval restrictions.
4. Configure `supabase/schedule.sql` for retry-safe weekly cycles/deadline evaluation. Research leadership can also explicitly open a cycle. Pause scheduled jobs during staging imports.
5. Configure regular database and storage backups and perform a restore before production cutover.

Deployment verified October 4, 2026: the UX fixes are merged into `master` at `2db9f7f`, and the [GitHub Pages deployment](https://github.com/AbrahamPadua/The-External-Brain/actions/runs/37170808336) succeeded. The JavaScript and CSS served by the [live site](https://abrahampadua.github.io/The-External-Brain/) matched a fresh local production build byte for byte. Public Home, Catalog, and initiative Overview/Team pages were checked; authenticated live submissions were not retested.

The same audit found that hosted `initiative_catalog` lacked `execution_plan`, so migration `025` still requires hosted application and verification. In the live Supabase project's SQL Editor, run the complete `supabase/migrations/202610030025_proposal_execution_plan.sql` file, including its transaction, then verify with `select execution_plan from public.initiative_catalog limit 1;`. The query must succeed; an empty value is normal for existing initiatives. Frontend deployment alone does not apply database migrations. Scheduled processing, backup/restore, import reconciliation, and member cutover were not verified by this audit.

## Publish to GitHub Pages

Push this repository to the chosen organization repository. Under **Settings > Pages**, select **GitHub Actions** as the source. Under **Settings > Secrets and variables > Actions > Variables**, add two repository *variables* (not secrets, not environment-scoped):

- `VITE_SUPABASE_URL` — the `https://<project-ref>.supabase.co` base URL, with no path, query or fragment.
- `VITE_SUPABASE_ANON_KEY` — a publishable `sb_publishable_...` key or a legacy `anon` JWT. Never a service-role key or an `sb_secret_...` key.

Then run the **Publish The External Brain** workflow (`workflow_dispatch`, or a push to `main`/`master`). Its prebuild guard refuses to deploy if either variable is missing or wrongly shaped, so the fictional demo data set is never published as if it were live. Validate that guard offline before pushing with `node app/scripts/check-pages-config.mjs` from the repository root; it replays the workflow guard against synthetic fixtures and reads no `.env`, project settings or network. All protected data stays in Supabase; the public JavaScript bundle contains only the publishable/anon key. Hash routes work under either a custom domain or repository subpath. The current deployment uses GitHub Actions and both repository variables; see the verified deployment status above.

Do not switch members from Notion until the approved-account gate, email delivery, live permissions and migration reconciliation have been verified against the selected project. Public initiatives are visible on the live site; this deployment audit does not establish import reconciliation or member cutover.

## Essential validation

From `app/`:

- `npm run build` — TypeScript and production bundle.
- `npx vitest run src/domain.test.ts` — deadline, HP and permission boundaries.
- `node scripts/check-database.mjs` — executes real PostgreSQL migrations using PGlite, with a minimal Supabase auth/storage harness. Checks pending/suspended access, private drafts, submissions, duplicate rewards, late penalties and `initiative-images` read scoping (participant and assigned-reviewer allowed; unrelated approved and non-approved denied). This does not replace verifying production Supabase configuration.

From the repository root:

- `node app/scripts/check-pages-config.mjs` — replays the GitHub Pages prebuild guard from `.github/workflows/pages.yml` against synthetic fixtures: confirms it accepts a publishable or legacy `anon` key and rejects missing, secret and service-role values, and never echoes a key. Offline; reads no `.env` or network.

See `docs/MIGRATION.md` for the source-capture reconciliation gate. No real member data, credentials, or Notion export belongs in this repository.
