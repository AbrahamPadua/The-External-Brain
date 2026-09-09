# Open Labs backend contract

Apply `supabase/migrations/202609090001_open_labs.sql` in a new Supabase project. It deliberately contains no project URL, API key, SMTP credential, or deployment command.

## Client contract

The browser uses the anon key and invokes RPC functions for every privileged transition. All account statuses except `approved` can read only their own profile and public active initiative summaries. A verified sign-in is therefore insufficient for any internal record.

| RPC | Inputs | Result / rule |
| --- | --- | --- |
| `decide_account` | `p_user`, `p_status`, `p_reason` | Operations or Research; cannot decide own account |
| `grant_role` | `p_user`, `p_role` | Operations only; cannot self-grant |
| `decide_proposal` | `p_proposal`, status, reason | Research only; approval creates initiative and lead membership |
| `decide_join_request` | request, approve, reason | Initiative lead or admin; approval creates membership |
| `assign_review` | review obligation, reviewer, optional due time | Research only; blocks same-initiative reviewers |
| `submit_obligation` | obligation, rich-text JSON, reviewed doc/version for reviews | Responsible user only; immutable submitted version; adds +4 once and reverses an existing -10 if late |
| `evaluate_due_obligations` | optional timestamp | Research/scheduler service role; retry-safe missed penalties |
| `set_initiative_status` | initiative, state, reason | Research only; holds/closures waive remaining obligations |
| `hp_balance` | initiative | Returns `0..100`, calculated from the immutable ledger |
| `create_task` / `update_task_status` | task fields / task and status | Initiative lead/admin creates; lead/admin/assignee updates status |
| `create_document_draft` | obligation, rich-text JSON | Responsible reviewer or initiative team member; optimistic revision is returned by selecting `document_drafts` |
| `add_comment` / `resolve_comment_thread` | document anchor/body/thread fields | Approved participant with initiative access; comments stay anchored to a submitted version |

Rich text is `{ "blocks": [...] }`; every anchorable block must retain a stable `id`. `document_versions` are immutable submissions. Draft autosave uses `document_drafts` and should send the last observed `revision` in a future conflict-aware wrapper; it is intentionally separate from submitted versions.

## Scheduling

A privileged scheduled invocation must call `evaluate_due_obligations()` after the Friday and Sunday Los Angeles deadlines. The function is idempotent: an obligation moves from `open` only once and the partial unique index blocks duplicate penalties. Create cycles with deadline timestamps calculated in `America/Los_Angeles`; do not let a browser calculate deadlines.

## Bootstrap and storage

The first approved Operations account must be created through the Supabase SQL editor by an organization administrator, then role grants can use normal RPC. Keep `initiative-images` private. Its policy expects the first storage path segment to be the initiative UUID; upload must be performed by a server/Edge Function that verifies the uploader's approved membership before inserting an object. Never expose service-role credentials to the browser.

Bootstrap example (replace the UUID after creating the first verified user): `update public.profiles set account_status='approved' where id='<uuid>'; insert into public.role_grants(user_id,role,granted_by) values('<uuid>','operations','<uuid>');`. This is the only deliberate exception to the no-self-approval rule.

## Important implementation notes

`hp_events` is append-only by application convention and has no client insert/update/delete policy. Reversals reference the original event. The current migration waives outstanding work on hold/closure; a follow-up scheduler/command should explicitly reassign external reviews before a project hold if desired. Historical imports should use a service-role, recorded import actor and source provenance; they must not approve users or infer late status.
