# Notion migration gate

No production records have been imported yet. The signed-in sample established that RMs, review pages, inline comment threads and attachments must all be captured. A gallery export alone is not sufficient.

Keep the captured snapshot in `import-private/` (ignored by Git). Use an authorized Notion connection or signed-in browser. Never change workspace sharing to obtain data. Read every nested block and paginate records/comments. Preserve source page IDs and permalinks, timestamps, attribution and reply relationships. Expiring attachment URLs do not count as retained files.

Before production import, run `node scripts/check-import.mjs ../import-private/manifest.json` from `app/`. The manifest has `capturedAt`, `sourceWorkspace`, `expectedCounts` and a `records` array. Each record has `kind`, `sourceId`, `sourceUrl`, `complete`; children have `parentSourceId`; authored records have `authorSourceId`; thread anchors have `quote`/`blockSourceId`; attachments have `localPath` or `durableUrl`. Allowed kinds: initiative, rm, review, thread, comment, attachment, person. Content may be stored alongside each record, but do not put credentials in the manifest.

Resolve missing parents and incomplete captures before mapping into relational tables. Preserve unmatched people as historical identities; do not create approved accounts or match by display name. Historical timestamps are not evidence of original deadlines, and missing submission versions cannot be reconstructed. Keep old HP as metadata; approved opening balances are 100. Never evaluate historical obligations for new penalties.

The final relational import must run in staging first, in a transaction with unique source IDs, then compare source and destination counts and relationships. Finalize exact field mapping from the complete source snapshot; the currently inspected sample is not a complete inventory. Source IDs, author identity handling, attachments, and comment anchors must reconcile before cutover. Keep Notion intact. No destructive migration or production cutover is authorized by this file.
