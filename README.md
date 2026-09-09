# Open Labs · Decoded Brain UCSD

React/TypeScript client for GitHub Pages and a Supabase PostgreSQL backend. Account approval is separate from email verification and initiative participation. New sign-ups remain pending until Operations or Research approves them.

## Run locally

From `app/`: `npm ci`, then `npm run dev`. Without Supabase environment settings the app uses a visibly labeled, fictional local demo. Demo data is stored only in your browser and is never a production identity or permission system.

For live mode, copy `app/.env.example` to `app/.env.local` and set your Supabase project URL and **publishable/anon** key. Never use a service-role key in a Vite environment variable. Restart the development server after changes.

## Backend setup

1. Create an organization-owned Supabase project and apply every file in `supabase/migrations/` in filename order.
2. Enable email magic-link authentication, configure production SMTP, and register the exact local/deployed redirect URL in Supabase Auth settings.
3. Sign up the initial Operations administrator. An organization owner then approves that user's UUID and grants the Operations role through the Supabase SQL editor; see `docs/BACKEND.md`. This is the only bootstrap exception to self-approval restrictions.
4. Configure `supabase/schedule.sql` for retry-safe weekly cycles/deadline evaluation. Research leadership can also explicitly open a cycle. Pause scheduled jobs during staging imports.
5. Configure regular database and storage backups and perform a restore before production cutover.

## Publish to GitHub Pages

Push this repository to the chosen organization repository. Select **GitHub Actions** as the Pages source. Set repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Run the Publish Open Labs workflow. All protected data stays in Supabase; the public JavaScript bundle contains only the publishable key. Hash routes work under either a custom domain or repository subpath.

Do not switch members from Notion until the approved account gate, email delivery, live permissions and migration reconciliation have been verified against the selected project.

## Essential validation

From `app/`:

- `npm run build` — TypeScript and production bundle.
- `npx vitest run src/domain.test.ts` — deadline, HP and permission boundaries.
- `node scripts/check-database.mjs` — executes real PostgreSQL migrations using PGlite, with a minimal Supabase auth/storage harness. Checks pending/suspended access, private drafts, submissions, duplicate rewards and late penalties. This does not replace verifying production Supabase configuration.

See `docs/MIGRATION.md` for the source-capture reconciliation gate. No real member data, credentials, or Notion export belongs in this repository.
