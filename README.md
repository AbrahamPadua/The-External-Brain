# The External Brain · Decoded Brain UCSD

React/TypeScript client for GitHub Pages and a Supabase PostgreSQL backend. Account approval is separate from email verification and initiative participation. New sign-ups remain pending until Operations or Research approves them.

## Run locally

From `app/`: `npm ci`, then `npm run dev`. Without Supabase environment settings the app uses a visibly labeled, fictional local demo. Demo data is stored only in your browser and is never a production identity or permission system.

For live mode, copy `app/.env.example` to `app/.env.local` and set your Supabase project URL and **publishable/anon** key. Never use a service-role key in a Vite environment variable. Restart the development server after changes.

## Backend setup

1. Create an organization-owned Supabase project and apply every file in `supabase/migrations/` in filename order. The available migration set is `001`–`007`: `005` adds an account-email lookup (`admin_account_emails`) limited to approved Operations or Research administrators, `006` hardens review integrity (conflict-of-interest re-checked at submission, un-judgeable reviews released to Research on lead transfer, retry-safe missed-obligation penalties that can recur after a reversal), and `007` narrows `initiative-images` reads to the owning initiative's current participants and the reviewers assigned to it.
2. Enable email magic-link authentication, configure production SMTP, and register the exact local/deployed redirect URL in Supabase Auth settings.
3. Sign up the initial Operations administrator. An organization owner then approves that user's UUID and grants the Operations role through the Supabase SQL editor; see `docs/BACKEND.md`. This is the only bootstrap exception to self-approval restrictions.
4. Configure `supabase/schedule.sql` for retry-safe weekly cycles/deadline evaluation. Research leadership can also explicitly open a cycle. Pause scheduled jobs during staging imports.
5. Configure regular database and storage backups and perform a restore before production cutover.

On the current target project: migrations `001`–`007` are applied (`007` storage read privacy confirmed applied by the operator; local database checks pass), custom SMTP is configured, and the first Operations administrator has signed up and verified their email. Scheduled processing (`supabase/schedule.sql`) and backup/restore have not been exercised yet. GitHub Pages is configured — the source is set to GitHub Actions and the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` repository variables are present — but this code has not been pushed and no deployment has run. No Notion member cutover has been done.

## Publish to GitHub Pages

Push this repository to the chosen organization repository. Under **Settings > Pages**, select **GitHub Actions** as the source. Under **Settings > Secrets and variables > Actions > Variables**, add two repository *variables* (not secrets, not environment-scoped):

- `VITE_SUPABASE_URL` — the `https://<project-ref>.supabase.co` base URL, with no path, query or fragment.
- `VITE_SUPABASE_ANON_KEY` — a publishable `sb_publishable_...` key or a legacy `anon` JWT. Never a service-role key or an `sb_secret_...` key.

Then run the **Publish The External Brain** workflow (`workflow_dispatch`, or a push to `main`/`master`). Its prebuild guard refuses to deploy if either variable is missing or wrongly shaped, so the fictional demo data set is never published as if it were live. Validate that guard offline before pushing with `node app/scripts/check-pages-config.mjs` from the repository root; it replays the workflow guard against synthetic fixtures and reads no `.env`, project settings or network. All protected data stays in Supabase; the public JavaScript bundle contains only the publishable/anon key. Hash routes work under either a custom domain or repository subpath. The Pages source is already set to GitHub Actions and both repository variables are present; this code has not been pushed and no deployment has run yet.

Do not switch members from Notion until the approved-account gate, email delivery, live permissions and migration reconciliation have been verified against the selected project. No Notion import has been performed yet.

## Essential validation

From `app/`:

- `npm run build` — TypeScript and production bundle.
- `npx vitest run src/domain.test.ts` — deadline, HP and permission boundaries.
- `node scripts/check-database.mjs` — executes real PostgreSQL migrations using PGlite, with a minimal Supabase auth/storage harness. Checks pending/suspended access, private drafts, submissions, duplicate rewards, late penalties and `initiative-images` read scoping (participant and assigned-reviewer allowed; unrelated approved and non-approved denied). This does not replace verifying production Supabase configuration.

From the repository root:

- `node app/scripts/check-pages-config.mjs` — replays the GitHub Pages prebuild guard from `.github/workflows/pages.yml` against synthetic fixtures: confirms it accepts a publishable or legacy `anon` key and rejects missing, secret and service-role values, and never echoes a key. Offline; reads no `.env` or network.

See `docs/MIGRATION.md` for the source-capture reconciliation gate. No real member data, credentials, or Notion export belongs in this repository.
