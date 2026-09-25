# Initiative abstract update

The existing Overview becomes the sole Abstract. Motivation remains separate. Both sections are edited in place using the same rich-text renderer as the reading view, with formatting, line breaks and image uploads. No separate bottom editing form appears. Plain-text summaries remain available to the catalog. Recognized corrupted quotes and dashes are repaired. Each rich body has a 100,000-character limit.

Edit initiative sits at the bottom left; Ask to join sits at the bottom right when applicable. Approved current initiative members (including the lead) and accounts explicitly granted Research can edit. An unrelated Operations or Admin account does not gain this permission through its role alone. Database checks enforce the same rule as the app.

The overview has wider responsive padding. Manage cover sits at the bottom right of the actual cover, subdued until hovered or keyboard-focused and fully visible on touch devices. Its expanded controls open in a modal. Cover permissions are unchanged.

## Apply before publishing

On 2026-09-25 the operator reported completing the migrations and requested publication. The steps below remain the setup instructions for a fresh environment; do not replay already-applied migrations. The publishing agent has not independently verified hosted SQL execution.

Run `supabase/migrations/202609250020_initiative_abstract.sql` in the same Supabase project's SQL Editor after migrations 018/019. Copy with explicit UTF-8:

```powershell
Get-Content -Raw -Encoding UTF8 supabase/migrations/202609250020_initiative_abstract.sql | Set-Clipboard
```

The transaction promotes current `content.html` text into `summary`, falling back to the current summary when no overview exists. It decodes HTML entities, preserves paragraphs, cleans punctuation in Abstract/Motivation, and clears the redundant active HTML field. The original summary, HTML, and motivation remain under `content.abstract_promotion_backup`. Source metadata, membership, documents, and tasks are unchanged. A marker makes reruns preserve later edits. Do not replay the old presentation repair to apply this change.

Next, apply `supabase/migrations/202609250021_initiative_content_images.sql` once:

```powershell
Get-Content -Raw -Encoding UTF8 supabase/migrations/202609250021_initiative_content_images.sql | Set-Clipboard
```

Migration 021 adds the rich-content save RPC and private `initiative-content-images` bucket. Approved accounts can read these initiative overview images; only current members and explicit Research can upload. Images are limited to PNG/JPEG/GIF/WebP and 10 MiB. Saving validates that object references belong to this initiative and exist. The app stores object paths and refreshes signed URLs on reload, with retry controls for unavailable images. Existing uploaded bytes cannot be replaced or deleted through browser storage policies; cancelling an edit can leave an unused private upload. The local demo uses temporary browser image URLs; durable reload behavior is provided by live storage.

Then publish the app through the existing Pages workflow. Verify an initiative with a former Overview, edit a multiline Abstract in place as a member, attach an image, save and reload. Confirm Cancel discards edits and an unrelated approved account cannot edit/upload. A Research account outside the team should see Edit initiative on the left and Ask to join on the right. Check Manage cover with pointer and keyboard focus.

## Local checks

From `app/`:

```powershell
node scripts/check-initiative-abstract.mjs
node scripts/check-initiative-continuation-edits.mjs
node scripts/check-initiative-content-images.mjs
npx vitest run src/initiative-details.test.ts src/initiative-overview.test.tsx src/initiative-continuation.test.ts src/DocumentImages.test.tsx src/image-refs.test.ts src/preview-gateway.test.ts
npm run build
```

The checks exercise an offline database and local fixtures. They do not apply hosted SQL or publish the app. Hosted migration execution requires authenticated database access, which is not available in this workspace.
