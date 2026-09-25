# Initiative import implementation plan

Import the supplied initiatives into the normal catalog. Show their real titles and text lead names. Members must be able to resume the projects, edit their details, manage tasks, and publish new Roast Mes through the existing workflow. Do not show a historical label, archive section, or separate imported-initiatives page.

This plan replaces the real-lead-before-import requirement and historical presentation instructions in `docs/HISTORICAL_IMPORT.md`. It uses the repository schema through migration `017`. Check the applied migration list once before applying changes to a hosted database; this planning pass did not inspect the hosted schema.

## Working rules

- Implement the numbered tasks in order. Finish one task before starting the next.
- Use the existing React app, SQL migrations, RPCs, import scripts, and PGlite checks. Do not add a framework or redesign the import system.
- Keep source files, extracted content, manifests, generated import SQL, and database snapshots in ignored `import-private/`.
- Preserve existing local changes. Only commit files changed for this plan.
- Do not create accounts, match people by name, or assign a temporary lead. Existing real assignments stay intact.
- Record missing source information in the private manifest. Do not invent dates, authors, task details, reviews, or attachments.

## 1. Inventory and map the supplied files

Read `import-private/initiatives/ucsd-initiatives/`. It contains **38 PDFs: 6 initiative pages and 32 RM files**. Ignore `.DS_Store`. There are six source initiatives, not four: folder names do not define initiative identity.

| Source PDF, relative to that directory | Source identity | Initial status | Text lead |
| --- | --- | --- | --- |
| `brain-dj/brain-dj-2.pdf` | OLIN-29 — Brain DJ Interface (BDJI) | `completed` | Enrique Aranda |
| `brain-dj/brain-dj.pdf` | OLIN-131 — Brain DJ Interface: Remixed | `active` | Enrique Aranda |
| `eeg-controlled/eeg-controlled-2.pdf` | OLIN-35 — EEG Controlled Humanoid Robot | `stopped` | Thejo Tattala |
| `eeg-controlled/eeg-controlled.pdf` | OLIN-139 — EEG-Controlled Humanoid Robot | `active` | Thejo Tattala |
| `eeg-fundamentals/eeg-fundamentals.pdf` | OLIN-144 — EEG Fundamentals: A Workshop Series | `stopped` | Unspecified in the inspected page; leave empty |
| `sona/sona.pdf` | OLIN-145 — SONA: Spatial Onset Navigation Aid | `active` | Abraham Padua |

Use the page's Lead property first, then its explicit initiative-lead paragraph. OLIN-29 has an older paragraph naming Evan Chou; preserve that paragraph, but use the Lead property above for the display. Keep the AURORA rename note in OLIN-131's description; do not silently rename or merge records.

Create `import-private/initiatives/ucsd-import/manifest.json` with one entry per source record: source identity, relative file, checksum, parent initiative identity, title, extracted content, source author/date when present, and target database ID when already matched.

Use `pdftotext -layout` to extract text. Inspect PDF pages when tables, images, or ordering are unclear. The RM folders contain 18 Brain DJ, 9 robot, and 5 SONA files. Assign each RM using the parent page's RM references, source links/IDs, and content. Do not attach every file to the newest initiative in its folder. Preserve embedded reviews under their actual RM. Keep source text and available images; missing linked task pages or attachments belong in the manifest's gap list.

Compare SONA and robot records with the existing canonical payload and a read-only database export. Reuse existing initiative/document IDs and source keys where the records match. The previous robot importer combined some RMs by period; map those source PDFs to that existing document rather than duplicating them. A title match alone is insufficient. Resolve ambiguous mappings before generating SQL for those records; continue the other records.

**Done:** all 38 PDFs are accounted for, the six identities stay distinct, and existing records have explicit mappings.

## 2. Allow a lead name before an account exists

Add `supabase/migrations/202609240018_initiative_import_continuation.sql` (use the next unused suffix if 018 is taken). Do not rewrite earlier migrations.

1. Make `initiatives.lead_id` nullable while keeping its foreign key. Add `lead_name text not null default ''`, trimmed and limited to 160 characters. Store the source name there; an unknown name stays empty.
2. Update `open_cycle` and `run_weekly_processing` to require `i.lead_id is not null` before creating obligations. An active initiative without an assigned lead must not break the weekly job or receive obligations or penalties.
3. Update `transfer_lead` to handle the first assignment. Research/Admin may choose an approved account for an unassigned initiative; create its active lead membership in the same transaction. Reject pending/suspended accounts. Keep existing transfer safeguards for initiatives that already have a lead, including review conflicts and obligation reassignment.
4. On the first assignment, set `activated_at = now()` for an active initiative so scheduled processing does not backfill old weeks. Preserve `lead_name` as source information. Do not create old obligations or HP events.
5. Keep the existing join approval, status change, task, and submission rules. Return a clear “Assign a lead first” error if submission would require a missing lead. Do not weaken RLS or account approval checks.

**Done:** an initiative can exist with `lead_id = null`, and a later explicit assignment makes it work through the normal workflow.

## 3. Make the normal UI support continuation

Edit `app/src/model.ts`, `app/src/live.ts`, `app/src/demo.ts`, and the relevant sections of `app/src/App.tsx`.

- Add `leadName` to the initiative model. Map database `lead_id = null` to `leadId: ''`, matching the app's existing empty-ID convention. Empty IDs never grant permissions or count as members.
- Use one lead-display helper in the catalog, initiative header, and team view: linked account name when available; otherwise `leadName`; otherwise “Unassigned”. Keep existing public/private data boundaries.
- Add “Assign lead” for Research/Admin when no account is assigned. Offer approved accounts, call `transferLead`, then reload the data. Normal transfers continue to use the existing controls.
- Add an “Edit initiative” form for its assigned lead and Research/Admin: title, abstract, category, motivation, and overview body. Add a matching `update_initiative_details` RPC with the same authorization, input checks, and audit entry. Preserve other keys in `initiatives.content`. Store the body in `content.html` and render it through the existing sanitized editor. Mirror this action in demo mode.
- Keep source statuses from the table. Use the normal status control to reactivate a completed/stopped initiative later. Approved members must be able to find those initiatives in the normal catalog's status filters.
- Remove user-facing “historical” badges, suffixes, explanatory banners, and separate historical sorting. Use the normal Documents list with source dates/week labels when available. Do not fabricate a submission date to make sorting work.
- Reuse the existing imported-document storage shape and provenance flags internally; their legacy names are not UI labels. Do not clear them just to hide a badge: the database uses them to allow source authors without accounts and documents without old obligations.
- Let the assigned lead or Research/Admin revise a source RM through `revise_rm`, retaining version 1, attribution, and review links. Extend the imported-RM branch's permission check and UI button accordingly; retain expected-version conflict checks. New RM drafts, tasks, and weekly submissions use the existing live paths. Existing submitted reviews retain their versioned source records.

**Done:** a project is usable before assignment by authorized administrators, and its assigned team can resume normal work afterward.

## 4. Build the import against the updated schema

Use the existing `build-canonical-import*.mjs` files as reference, but add a dedicated `import-private/initiatives/ucsd-import/build-import.mjs` for this manifest. Do not rerun the old SONA-only SQL unchanged.

| Source content | Destination |
| --- | --- |
| Title, overview, motivation, category | `initiatives.title`, `summary`, `content.html`, `content.motivation`, `content.category` |
| Lead text | `initiatives.lead_name`; new initiatives get `lead_id = null` |
| Source identity | Existing unique `historical_source_key`; use `ucsd:OLIN-…` for new initiatives and retain existing keys for matched rows |
| RM and embedded reviews | `documents` plus `document_versions`, using the existing account-less import shape and source provenance |
| Explicit task entries | `tasks`, using `planned`, `pending`, or `finished`; unknown status becomes `planned`, unknown assignee/due date stays null |
| Source HP, dates, contributor names | Provenance in `content`; do not create memberships, penalties, or claimed live submissions from them |

For tasks, `created_by` must be the real approved import operator, never the source lead or an invented profile. Keep unmapped source assignee names in the task description. Only import stated tasks; do not turn every RM “next steps” sentence into a task.

Generate a transaction-wrapped SQL file and a reconciliation report. Use stable source keys/target IDs for every record, including tasks. Insert missing records, accept exact matches, and report conflicts. Never overwrite content, lead assignments, tasks, or versions that members have changed. Do not delete old imports or create a second copy of SONA. Keep the original version and source links when matching an existing compiled RM.

Preserve supplied embedded images using the existing private storage/object-path conventions. Do not use expiring source links as the retained copy or bypass the storage MIME rules to upload PDFs into an image bucket.

**Done:** a second execution makes no duplicates or unwanted updates, and the report lists inserted, matched, conflicted, and missing-source records.

## 5. Verify, then prepare the application steps

Add `app/scripts/check-initiative-import.mjs`, using the existing PGlite harness. Test these behaviors:

1. Import twice: stable counts and links, no duplicate SONA, no fabricated accounts/memberships/cycles/obligations/HP events.
2. An active initiative with a text-only lead is skipped by both cycle routines; assigned initiatives still process normally.
3. Research/Admin can assign an approved account later. Unauthorized and unapproved accounts cannot. The correct membership and display name appear.
4. An authorized user can edit initiative details and revise a source RM without losing version 1. After assignment/reactivation, the team can create tasks and submit a new RM using a valid current cycle.
5. Rerunning the import preserves those user edits and assignments.

Run from `app/`: `node scripts/check-initiative-import.mjs`, `node scripts/check-database.mjs`, `node scripts/check-rm-cycle.mjs`, and `node scripts/check-rm-revision-and-media.mjs`. Run `npm run build`. Fix failures caused by this change; stop adding checks once these pass.

Check the browser once: text lead, assignment, edit/save/reload, stopped-project discovery, new RM, and no historical labels.

Write `docs/INITIATIVE-IMPORT-RUNBOOK.md` with exact commands and expected counts from the finished manifest. Order: confirm applied migrations and existing IDs; apply the new migration; upload retained assets; run the generated transaction; verify counts and links; publish the app and check the normal catalog. Record unresolved source gaps plainly. This task requests a plan only; implementation, database writes, and publishing have not been performed.

## Prompt to give each implementing model

> Read `docs/INITIATIVE-IMPORT-PLAN.md`. Complete task [NUMBER] only, using the completed earlier tasks. Follow the decisions already written; do not redesign them. Preserve unrelated changes. Run that task's checks. Report files changed, checks run, and any exact blocker in at most five bullets. Do not claim to have imported or deployed anything you did not execute.
