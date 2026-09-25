# Initiative Progress

Progress replaces Documents as the second initiative tab. Existing `/documents` hash URLs remain compatible; new links use `/progress`.

RMs are grouped by their actual cycle week or known source date. Source period/week labels remain intact where dates are unavailable; dates are not invented. Reviews are nested under their actual RM, including reviews owned by another initiative. Reviews without a local target remain accessible under Other reviews. Review drawers appear only when reviews exist. Sorting supports newest, oldest, most reviewed, and submitted RMs awaiting review. Counts, author names, statuses, excerpts, and links come from stored records.

Roast opens or creates a review for the selected submitted RM. As requested, any approved member can use it, including members of the RM's initiative. Pending/suspended accounts cannot. An existing open Research assignment is reused and retains its conflict-of-interest and accountability rules. Otherwise the review is voluntary, pinned to the RM version shown when it was created, and creates no obligation, cycle, deadline, reward, or penalty. Repeated clicks reuse that member's review for the same RM/version. Drafts remain private to their author; submitted reviews use the existing approved-member reading rules. Revisions append versions and preserve the original target.

## Rollout

On 2026-09-25 the operator reported completing the migrations and requested publication. This records operator-reported completion, not independent verification of hosted SQL. App publication is tracked separately.

For a fresh environment, after migrations 020 and 021, apply `supabase/migrations/202609250022_progress_reviews.sql` once in the project SQL Editor. Do not replay already-applied migrations. Copy explicitly as UTF-8:

```powershell
Get-Content -Raw -Encoding UTF8 supabase/migrations/202609250022_progress_reviews.sql | Set-Clipboard
```

Then publish the app through GitHub Pages. Verify Progress tab ordering, old Documents links, multiple RMs in one week, nested reviews, and Roast as an approved member. Save, submit, and reopen the review, and confirm the RM version stays pinned. Verify pending accounts cannot create reviews and assigned review submissions retain their existing rules.

## Local validation

From `app/`:

```powershell
node scripts/check-progress-reviews.mjs
npx vitest run src/progress.test.tsx src/backlog-ui.test.ts src/preview-gateway.test.ts
npm run build
```

These checks use local fixtures and an offline database. They do not execute hosted SQL or publish the app.
