# The External Brain backend contract

Apply ALL numbered files in `supabase/migrations/` in order in a new Supabase project. Later migrations supersede the initial policies and commands; applying only the first file is unsafe. No migration contains project credentials. The available migration set is `001`–`007`, all applied on the target project; `007` (`storage_privacy`) was confirmed applied by the operator and the local database checks pass.

## Client contract

The browser uses the anon key and invokes RPC functions for every privileged transition. All account statuses except `approved` can read only their own profile and public active initiative summaries. A verified sign-in is therefore insufficient for any internal record.

| RPC | Inputs | Result / rule |
| --- | --- | --- |
| `decide_account` | `p_user`, `p_status`, `p_reason` | Operations or Research; cannot decide own account |
| `grant_role` | `p_user`, `p_role` | Operations only; cannot self-grant |
| `admin_account_emails` | none | Approved Operations or Research administrators only; returns `(user_id, email)` for every profile. Not granted to `anon` (migration `005`) |
| `decide_proposal` | `p_proposal`, status, reason | Research only; approval creates initiative and lead membership |
| `decide_join_request` | request, approve, reason | Initiative lead or admin; approval creates membership |
| `assign_review_target` | `p_obligation`, `p_target` (submitted RM), `p_due_at` | Research only; points an existing review obligation at a submitted RM version and blocks any reviewer who belongs to the reviewed initiative |
| `submit_obligation` | obligation, rich-text JSON, reviewed doc/version for reviews | Responsible user only; immutable submitted version; adds +4 once and reverses an existing -10 if late |
| `evaluate_due_obligations` | optional timestamp | Research/scheduler service role; retry-safe missed penalties |
| `set_initiative_status` | initiative, state, reason | Research only; holds/closures waive remaining obligations |
| `hp_balance` | initiative | Returns `0..100`, calculated from the immutable ledger |
| `create_task` / `update_task_status` | task fields / task and status | Initiative lead/admin creates; lead/admin/assignee updates status |
| `save_document_draft` | `p_obligation`, `p_content` (rich-text JSON), `p_revision` | Responsible user or initiative participant; rejects a save whose `p_revision` is behind the stored draft revision. Read back the current revision from `document_drafts` |
| `add_comment` / `resolve_comment_thread` | document anchor/body/thread fields | Approved participant with initiative access; comments stay anchored to a submitted version |

Rich text is `{ "html": "...", "title": "...", "blocks": [...] }`. `document_versions` are immutable submissions. The client draft/assign paths are `save_document_draft(p_obligation,p_content,p_revision)`, which checks the last observed draft revision and rejects stale saves, and `assign_review_target(p_obligation,p_target,p_due_at)`, which points an initiative's existing review obligation at a submitted RM version. The earlier names `create_document_draft` and `assign_review` are **not** granted to clients — do not call them.

## Scheduling

Use `supabase/schedule.sql` for scheduled processing, or have Research call `open_cycle(p_monday,p_break)` and `evaluate_due_obligations()`. Cycle deadlines are calculated in Postgres using America/Los_Angeles. Unassigned reviews are never penalized. New/resumed initiatives first qualify in the following cycle. Scheduled processing is idempotent; do not evaluate future timestamps.

## Bootstrap and storage

The first approved Operations account must be created through the Supabase SQL editor by an organization administrator, then role grants can use normal RPC. Keep `initiative-images` private. Its policies expect the first storage path segment to be the initiative UUID; approved participants may upload. Migration `004` had widened the read policy to *any* currently approved account. Migration `007` narrows it back to the owning initiative's current participants plus any account holding a live review obligation (`open` or `submitted`) whose assigned RM belongs to that initiative — the audience that can already see the corresponding drafts. The first path segment is compared as `initiative_id::text = segment` (as the insert/delete policies do); the path is never cast to `uuid`. Operations and Research get no blanket image or draft access from `007`, and the `document_drafts` policy is unchanged. Limitation: objects are not linked to a specific document or version, so inline images on a *submitted* RM stay unavailable to approved members outside the owning initiative until an explicit attachment link exists. `007` is applied on the target project. The editor currently supports HTTPS inline image links. Never expose service-role credentials to the browser.

Bootstrap example (replace the UUID after creating the first verified user): `update public.profiles set account_status='approved' where id='<uuid>'; insert into public.role_grants(user_id,role,granted_by) values('<uuid>','operations','<uuid>');`. This is the only deliberate exception to the no-self-approval rule.

## Important implementation notes

Database triggers prevent edits/deletes to submitted versions, HP history and audit history. HP replay starts at 100, cancels reversed original contributions, and clamps after each effective event in stable sequence order. Holds/closures waive unfinished obligations and reverse their penalties. Unfinished reviews owed to other projects remain coverage gaps for leadership to reassign. Submitted target RMs remain readable.

Migration `006` re-checks reviewer conflict-of-interest at submission time, not only at assignment, so a membership change in between still blocks a tainted review. A lead transfer moves unfinished work — including reviews owed to other initiatives — to the new lead, but releases any review the new lead cannot judge back to Research (live penalty reversed, assignment cleared) rather than allowing self-review; a submitted RM then follows the lead role while its original responsible user, author and versions stay as history. The "at most one live penalty per obligation" rule moved from a unique index into `evaluate_due_obligations` (candidate row lock plus an explicit live-penalty guard): a penalty reversed by reassignment, waiver or break week can be charged again, while evaluator retries still never charge the same lapse twice.

Additional commands: `adjust_hp`, `transfer_lead`, `leave_initiative`, `set_policy`, `read_notification`, and `set_cycle_break`. `initiative_catalog` is a public projection of active titles/summaries only; direct initiative rows require approval. All approved accounts can read submitted documents and comment; only participants/assigned reviewers see drafts (text and revisions). Migration `007` gives `initiative-images` reads a comparable audience (initiative participants and assigned reviewers), with the linkage limitation noted in *Bootstrap and storage*. Sign-up, rejection and suspension do not grant initiative participation. Historical imports must preserve provenance without approving users or inferring late status.

Essential local verification: `node scripts/check-database.mjs` from `app/` executes all migrations against PGlite with mocked Supabase auth/storage schemas — including `initiative-images` read scoping (participant allowed, assigned reviewer allowed, unrelated approved denied, pending/suspended denied); `node app/scripts/check-pages-config.mjs` from the repository root replays the Pages workflow's Supabase-variable guard offline against synthetic fixtures. Live SMTP, storage read scoping under real `storage.objects`, `pg_cron` permissions and backup restoration still require verification in the chosen Supabase project. On the current project, migrations `001`–`007` are applied (`007` operator-confirmed; local checks pass), custom SMTP is configured and the first Operations administrator is signed up and email-verified; scheduled processing and backup/restore have not been exercised, GitHub Pages is configured (Actions source, both repository variables present) but this code is unpushed and no deployment has run, and no Notion import has been done.
