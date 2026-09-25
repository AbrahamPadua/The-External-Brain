# Initiative presentation repair

The repair formats the six initiative overviews and 31 imported RMs. It removes verified overview/motivation duplication, uses original PDF titles, and places 53 substantive image occurrences next to the source text. Imported reviews display as `Review of <RM title>`; their original versions and targets remain unchanged.

## Release record — 2026-09-25

The operator reported completing the SQL-related steps in this runbook and approved the resulting presentation for publication. This is operator-reported completion; the publishing agent did not execute or independently verify hosted SQL or storage uploads.

The app release includes readable imported titles, linked review labels, formatted overview and motivation sections, and retry controls for unavailable document images. It also includes the preceding import-continuation support: text lead names until account assignment, initiative detail editing, and permitted source RM revisions. Original document versions and review targets remain available. Unrelated catalog styling and local working notes are excluded.

Local verification covers title cleanup, image retry, image references, continuation permissions, import/repair database checks, and the production build. The earlier browser fixture checked 38 source previews and 53 inline picture occurrences without accessing the hosted database. Private source PDFs, generated SQL, snapshots, and image assets stay outside Git.

Publishing uses the existing GitHub Pages workflow on `master`. A successful Pages deployment verifies delivery of the app bundle; signed-in review of hosted records remains distinct from the offline fixture checks.

## Private repair artifacts

All source content, previews, baseline copies, before-images, and generated SQL remain under ignored `import-private/initiatives/ucsd-import/`:

- `presentation-layout.json`: ordered text, source page references, image positions, and excluded property icons.
- `presentation-preview/index.html`: previews for all 38 source PDFs.
- `presentation-baseline/`: the importer and payloads before this repair. Keep these copies; do not regenerate or replace them.
- `presentation-repair.sql`: one atomic SQL Editor statement; it requires a real approved operator UUID.
- `presentation-repair-report.json`: preparation status, snapshot date, and unresolved baseline differences. It is not an execution receipt.

The 159 original extracted image objects remain intact. Two additional PNGs combine source transparency masks with their images. The current upload manifest selects 131 RM objects, including these two replacements; existing old objects are not deleted. Only substantive pictures appear in RM bodies. Some source RMs contain no substantive picture.

## Refresh and generate

1. Run `export-live-reconciliation.sql` in the intended project's SQL Editor. Save the complete CSV as `live-reconciliation.csv` in the private import folder. This is read-only.
2. Run the local commands below. Inspect conflicts and the source previews. A changed or unrecognized member-written overview/RM is preserved, not automatically replaced.

```powershell
python import-private/initiatives/ucsd-import/reconcile-live.py
node import-private/initiatives/ucsd-import/build-import.mjs --check
node import-private/initiatives/ucsd-import/build-import.mjs
node import-private/initiatives/ucsd-import/build-presentation-repair.mjs --operator-id '<approved-profile-uuid>'
```

The existing `presentation-layout.json` is the reviewed source layout. If PDF sources change, regenerate it with `build-presentation.py` and inspect the new previews before regenerating SQL. That extractor uses PyMuPDF 1.28.2 and Pillow 12.3.0 from the private `tools/` folder.

The repair accepts only exact known original importer content or the reconciled SONA content whose original overview is unchanged. It preserves SONA's separate live motivation wording. The database rechecks current content under row locks, so a stale export cannot authorize overwriting an intervening edit. An open RM draft also prevents automatic repair.

## Verify locally

```powershell
node app/scripts/check-presentation-repair.mjs
node app/scripts/check-initiative-import.mjs
node app/scripts/check-database.mjs
node app/scripts/check-rm-cycle.mjs
node app/scripts/check-rm-revision-and-media.mjs
```

From `app/`, run the imported-title, DocumentImages, image-refs, and initiative-continuation Vitest tests, then `npm run build`. For the browser check, run `build-browser-fixture.mjs`, then `check-presentation-browser.mjs` from the private import folder. It bundles the real app and live adapter, uses installed Chrome, and intercepts all Supabase responses with local fixtures. It never accesses the live database. The retry check dispatches a DOM click; it is not a physical pointer test. Its report distinguishes fixture checks from hosted verification.

## Apply and publish

1. Confirm the schema markers for migrations 018/019 using the existing import runbook. Do not replay already-applied migrations.
2. Use `upload-assets.mjs` with the authorized storage credentials as described in that runbook. It compares remote bytes and refuses differing objects. Two newly derived PNGs may need uploading; already matching objects are reused.
3. Apply **the presentation repair**, not an older full import. Copy SQL explicitly as UTF-8 so Windows PowerShell does not corrupt punctuation:

```powershell
Get-Content -Raw -Encoding UTF8 import-private/initiatives/ucsd-import/presentation-repair.sql | Set-Clipboard
```

4. Run the whole statement once in SQL Editor. Save its per-record notices. `updated` means an overview was formatted or an RM version appended; `matched` means no content change; `conflicted`/`missing` need investigation. The transaction changes no tasks, assignments, source version 1 records, review targets, submissions, obligations, or HP events. It records audit entries for content changes.
5. Re-run the same repair to verify zero updates. From an unchanged old import, the first run adds 31 RM versions; later member edits or an already corrected import change that expectation. Do not force totals by deleting or overwriting records.
6. Publish the intended app changes through the existing Pages workflow. Keep unrelated workspace changes out of the release. Verify SONA's overview/motivation once each, original PDF titles, linked review labels, and images after reload as an approved user. Check an older version and image retry as well.

No hosted execution is implied by generating these files. A current CSV, an approved operator, storage access for missing objects, and deployment access are needed to finish the live rollout.
