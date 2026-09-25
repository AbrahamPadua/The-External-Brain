# UCSD initiative import: application runbook

For an already imported site, use `docs/INITIATIVE-PRESENTATION-REPAIR.md` to repair formatting and images without replacing versions. The counts below describe the updated generator on an unchanged baseline.

This is a staged operator procedure, not an execution record. No hosted migration, asset upload, import transaction, or Pages publication was performed for task 5. Run from the repository root in PowerShell. Keep the 38 supplied PDFs, 159 extracted pictures, manifest, SQL, reports, and any database export under ignored `import-private/`.

## 1. Confirm the hosted baseline and actual IDs

In the target Supabase SQL Editor, run these read-only queries separately and save the results privately. This project may have received earlier SQL through the Editor, which does not initialize the Supabase CLI's `supabase_migrations.schema_migrations` tracker. Saving an Editor query only saves its text; running it applies the SQL regardless of whether it was saved. Do not query or manually create that tracker, run `db push`, or use `migration repair` merely to make this preflight pass. Inspect the actual schema instead.

```sql
select
  to_regclass('public.task_attachments') is not null as m017_task_attachments,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'initiatives'
      and column_name = 'lead_id') as lead_id_nullable,
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'initiatives'
      and column_name = 'lead_name') as m018_lead_name,
  exists (select 1 from pg_constraint
    where conrelid = to_regclass('public.initiatives')
      and conname = 'initiatives_lead_name_valid') as m018_lead_name_constraint,
  coalesce(pg_get_functiondef(to_regprocedure('public.transfer_lead(uuid,uuid)'))
    like '%research required to assign the first lead%', false) as m018_first_assignment,
  to_regprocedure('public.update_initiative_details(uuid,text,text,text,text,text)')
    is not null as m019_edit_function,
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'initiative_catalog'
      and column_name = 'lead_name') as m019_catalog_lead_name,
  coalesce(pg_get_functiondef(to_regprocedure('public.revise_rm(uuid,jsonb,text,uuid,text,integer)'))
    like '%initiative lead or Research/Admin required%', false) as m019_source_rm_revision;
```

Run these identity/link queries separately from the marker query:

```sql
select historical_source_key, id, lead_id, status
from public.initiatives
where historical_source_key in (
  'local-canonical:20260910:sona',
  'local-canonical:20260910:eeg-controlled-humanoid-robot'
)
order by historical_source_key;
select d.historical_source_key, d.id, d.kind, d.initiative_id,
       d.reviewed_document_id, d.reviewed_version_number
from public.documents d
where d.historical_source_key like 'local-canonical:20260910:%'
order by d.historical_source_key;
```

Before migration 018, the first result should show `m017_task_attachments = true`, `lead_id_nullable = NO`, and every 018/019 marker `false`. After 018, `lead_id_nullable = YES` and all 018 markers should be `true`, while all 019 markers remain `false`. After 019, all markers should be `true`. If the markers show a mixed or unexpected state, stop and inspect the hosted schema before running either file. Do not replay a migration whose markers show it is already applied.

Compare IDs to `import-private/initiatives/ucsd-import/live-reconciliation-report.json` and `asset-upload-manifest.json`. The saved snapshot had SONA initiative `a4d811ab-f21f-4d1c-aedf-d3445469867e` and nine SONA documents. It also found a SONA `content.motivation` difference and an existing lead assignment; preserve both. The snapshot is time-specific. If IDs, content, versions, or source keys changed, capture a fresh read-only export with `export-live-reconciliation.sql`, reconcile it with `reconcile-live.py`, and rebuild before proceeding. Confirm a real, approved import operator profile UUID; never use a source author's name as the operator.

## 2. Apply continuation migrations

Apply these files in order in Supabase SQL Editor, each as one transaction. `Set-Clipboard` is only for transferring the local SQL into the Editor; review the text and project before pressing Run.

```powershell
Get-Content -Raw -Encoding UTF8 supabase/migrations/202609240018_initiative_import_continuation.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 supabase/migrations/202609240019_initiative_continuation_edits.sql | Set-Clipboard
```

Run the first file before copying/running the second. Re-run the schema-marker query from step 1 after each file and record the applied file names and SQL Editor execution IDs in the private operator log. Applying SQL through the Editor does not create CLI migration-history rows; file presence alone is not evidence of application.

## 3. Build and upload retained RM images

Confirm source integrity without changing the hosted database:

```powershell
node import-private/initiatives/ucsd-import/build-import.mjs --check
node app/scripts/check-initiative-import.mjs
```

The import uses **131 app-ready RM images** in the private `initiative-images` bucket. They are PNG/JPEG, about 95.6 MB in total. The other extracted pictures remain in `import-private/` and are not silently discarded. Each upload path uses the actual target initiative UUID from the reconciled manifest. Upload through the existing storage API; never upload PDFs to this image bucket.

```powershell
$env:SUPABASE_URL = 'https://<target-project-ref>.supabase.co'
$serviceRoleSecret = Read-Host 'Target project service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $serviceRoleSecret).Password
node import-private/initiatives/ucsd-import/upload-assets.mjs
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Expect `131 total`, with `uploaded + already matched = 131`. The helper checks local SHA-256, refuses unresolved IDs, compares existing remote objects byte-for-byte, and never overwrites a differing object. Keep the service-role key out of `app/.env.local`, Git, and the browser bundle. Stop on any mismatch or missing bucket.

## 4. Generate and run the transaction

Regenerate the SQL with the approved operator's **profile UUID** after reconciling the hosted baseline. Review `reconciliation-report.json` before running. Use `import-editor.sql` in Supabase SQL Editor: it is one atomic `DO` statement, so it cannot lose a setup-only temporary table between Editor executions. The separate `import.sql` is for a session-persistent SQL client and must be run as a whole transaction; do not paste selected fragments of it into the Editor. Both variants fail if a retained image path is absent. Do not reuse the older SONA-only SQL.

```powershell
node import-private/initiatives/ucsd-import/build-import.mjs --operator-id '<approved-profile-uuid>'
node app/scripts/check-initiative-import.mjs
Get-Content -Raw -Encoding UTF8 import-private/initiatives/ucsd-import/import-editor.sql | Set-Clipboard
```

Paste the complete file into the target Supabase SQL Editor, select all of that file, and run once. Do not execute only the `DO` body or an older snippet. Save the result-count and conflict notices if the Editor displays them; the step 5 queries are the authoritative verification if it does not. Stop and reconcile any unexpected conflict; the import never overwrites member edits. The generated SQL preserves SONA's existing identity, original compiled RM version 1, review links, live lead assignment, and edited details. A second execution is permitted only after the first result is reviewed; it should insert zero records. An earlier `_ucsd_payload does not exist` failure occurred before the import block's data writes, but verify counts before retrying in case another attempt completed.

## 5. Verify counts and links

With the finished manifest and an unchanged baseline, expect 6 initiatives from 38 PDFs, 31 target RMs, 11 linked reviews (42 imported documents), 54 imported document versions including 12 PDF source revisions (5 SONA and 7 robot), 29 explicit tasks, and 131 linked RM images. No accounts, memberships, cycles, obligations, or HP events are created by the import itself. Record pre/post counts for those live workflow tables so unrelated activity is not mistaken for import activity.

```sql
with target as (
  select id from public.initiatives where historical_source_key in (
    'ucsd:OLIN-29', 'ucsd:OLIN-131', 'ucsd:OLIN-35',
    'local-canonical:20260910:eeg-controlled-humanoid-robot',
    'ucsd:OLIN-144', 'local-canonical:20260910:sona'
  )
), source_docs as (
  select d.* from public.documents d join target t on t.id = d.initiative_id
  where d.is_historical_import
)
select
  (select count(*) from target) as initiatives,
  (select count(*) from source_docs where kind = 'rm') as rms,
  (select count(*) from source_docs where kind = 'review') as reviews,
  (select count(*) from public.document_versions v join source_docs d on d.id = v.document_id) as versions,
  (select count(*) from public.tasks t join target i on i.id = t.initiative_id) as tasks,
  (select count(*) from public.document_attachments a join source_docs d on d.id = a.document_id) as rm_images,
  (select count(*) from source_docs r left join source_docs d on d.id = r.reviewed_document_id
    where r.kind = 'review' and (d.id is null or d.kind <> 'rm'
      or r.reviewed_version_number <> 1)) as broken_review_links;
```

Expected row: `6 | 31 | 11 | 54 | 29 | 131 | 0`. Check the import output for inserted/matched/conflicted/missing-source records, confirm exactly one SONA source key, and spot-check stored image rendering and source PDFs. If members have edited a source record since the snapshot, investigate a higher version/task count rather than changing the expected manifest. The query counts target projects; a live new RM made after import is outside `source_docs`.

## 6. Publish and check the normal catalog

After review and a deliberate release commit containing only the intended tracked files, publish via the existing **Publish The External Brain** GitHub Actions workflow (`.github/workflows/pages.yml`). It runs on a push to `main`/`master` or `workflow_dispatch`. From a checked-out release branch already pushed to the remote, the manual trigger is:

```powershell
gh workflow run pages.yml --ref master
gh run list --workflow pages.yml --limit 3
```

Confirm the workflow used the target project's public Supabase URL and publishable/anon key, then check the deployed catalog once as visitor and approved Research/lead. Verify real text lead names, assignment membership, edit/save/reload, stopped-project discovery, source RM revision with version 1 retained, and a new RM in a valid current cycle. No historical badge, archive route, or duplicate SONA should appear. Do not run these application or publication steps as part of task 5.

## Unresolved source gaps and application blockers

- The saved hosted snapshot predates migrations 018/019: `lead_name` was absent, `lead_id` was non-nullable, and `update_initiative_details` was absent. Reconfirm the current hosted migration state in step 1.
- SONA's live motivation differs from source and its existing lead is assigned. These are preserved; a fresh conflict requires reconciliation, not overwrite.
- OLIN-29's Lead property names Enrique Aranda, while an older paragraph names Evan Chou. OLIN-131 mentions a future AURORA rename; the two projects remain distinct. OLIN-139 RM 7 says Week 4 where the canonical capture says Week 6.
- Five linked OLIN-139 RM 3 attachments, three linked Brain DJ poster/stream PDFs, and linked task-page details for OLIN-139/144 were not supplied. Empty Brain DJ review templates are not reviewer-authored feedback; no separate review pages were supplied beyond the embedded OLIN-29 feedback and existing canonical SONA/robot reviews.
- The browser pass before import saw only two active records in the connected catalog. It could not validate imported text leads, stopped projects, assignment, edits, or new RM submission against the six-source dataset. Run the post-import UI gate above before release.
