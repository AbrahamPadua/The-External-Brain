# Brainstorm Genesis and requests to lead

**Brainstorm Genesis** is the member-only catalog of ideas for others to lead, previously labeled **Project ideas**. The existing hash routes, persisted `project_idea` purpose, and database/RPC names remain compatible.

The shared **New project proposal** form has identical fields and requirements for both purposes. Saving a draft retains its content and stored purpose. The explicit **Submit to Brainstorm Genesis** or **Submit to lead this project** action chooses the submitted purpose; Enter in the form does not choose either action. Research can approve, decline, or request changes with feedback.

`proposals.purpose` is `own_initiative` by default for existing proposals, or `project_idea`. The `save_proposal(text,text,jsonb,boolean,uuid)` signature is unchanged. Supply purpose in `p_content.purpose`; invalid purposes are rejected, and omitting it on an edit preserves the stored purpose. Submitted and approved proposals cannot be edited.

Approval of an own initiative retains the existing initiative/lead-membership behavior. Idea approval only publishes the proposal; it creates no initiative, membership, HP event, or obligation. A proposer can later apply to lead their own approved idea.

## Catalog and access

- `#/catalog` and `#/catalog/initiatives` show Initiatives by default.
- `#/catalog/project-ideas` shows available approved ideas to signed-in, currently approved members using the shared search, discipline filters, and alphabetical sorting. Other accounts see only the Initiatives tab.
- `#/project-idea/<proposal-id>` shows members the approved abstract, plan, motivation, and proposer credit. Taken ideas remain reachable to members and link to their resulting initiative. Direct catalog/detail links require account approval before any idea content is rendered, including when demo data is already in memory.
- Migration `027` restricts `project_idea_catalog` to authenticated callers with currently approved accounts. Anonymous reads are denied; pending, rejected, suspended, and missing profiles return no ideas. The security-barrier owner projection contains only display content, proposer ID/display name, and resulting initiative ID. Raw proposals and review feedback keep their existing private policies.
- Initiatives remain publicly readable, including those started from ideas. Public initiative pages retain proposer credit but omit the original idea link; `initiative_catalog.project_idea_id` is null for visitors and unapproved accounts. Public live loading never queries the restricted ideas view.
- `idea_lead_requests` reads are limited to approved applicants reading their own requests and approved Research-authorized accounts. Operations alone cannot see applicant notes or decide them. Admin satisfies the existing Research role check.

## Lead-request commands

`request_idea_lead(p_proposal uuid,p_message text)` requires a currently approved account, an available approved idea, and a 10–2000 character interest/availability note. Multiple people may apply. A partial unique index permits one pending request per applicant/idea. A repeated pending application returns the existing request, and declined applicants can apply again.

`decide_idea_lead(p_request uuid,p_approve boolean,p_reason text)` requires Research. Decline requires feedback. Acceptance rechecks and locks the applicant's approved standing, copies the approved proposal into an active initiative, and adds only the applicant as the lead/first member. The original proposal and proposer credit are retained. The plan is stored separately from the abstract, matching migration `025`.

Both commands acquire the proposal lock first. The existing unique `initiatives.proposal_id` constraint also enforces one initiative per idea. Other pending requests become `taken` (**Taken up by another member**), with their own notifications and audit decisions. Retries of successful decisions do not add memberships, notifications, or audit entries. The proposer is notified when the idea starts. There are no immediate HP or weekly obligations: the existing `activated_at`/Los Angeles weekly-cycle rules apply to the new initiative.

Stopping an initiative does not reopen the idea. Approved idea editing and parallel copies are outside this version.

## Verification and rollout

Apply migrations `025`, `026`, and `027` as complete transactions before publishing the frontend. The operator applied `025` and `026` on October 4, 2026, and `027` on October 5. Migration `027` supersedes the original public-ideas access contract without altering proposals, initiatives, or memberships. Deploy the updated frontend promptly after `027`: older frontends still query the ideas view during public loading. `check-project-ideas-live.mjs` verifies public initiatives, withheld idea references, and anonymous denial using the frontend public key. It makes no hosted mutations and prints no configuration values.

Run from `app/`:

```text
node node_modules/vitest/vitest.mjs run src/project-ideas.test.ts src/project-ideas-ui.test.tsx src/project-ideas-live.test.ts
node scripts/check-project-ideas.mjs
node scripts/check-proposal-execution-plan.mjs
node scripts/check-database.mjs
node scripts/check-rm-revision-and-media.mjs
node scripts/check-pages-config.mjs
npm run build
node scripts/check-project-ideas-live.mjs
```

`check-project-ideas.mjs` executes actual PostgreSQL migrations offline through PGlite. It checks upgrade preservation, older-client edits, private drafts/notes, member projection shape and read-only privileges, anonymous/pending/rejected/suspended denial, approved member access, public initiative credit without private idea references, Research/account boundaries, competing applicants, duplicate requests, repeated decisions, suspended applicants, decline feedback, proposer applications, content/credit preservation, and next-cycle activation.

For full browser flows, start Vite on `127.0.0.1:5174` and run `node scripts/smoke-project-ideas.mjs` with the installed Chrome on Windows. This uses the fictional development fixture, creates isolated headless browser state, tests both complete approval paths, actual Enter-key behavior, private lead notes and competing applicants, and captures mobile/desktop screenshots under the system temporary directory. It performs no production submissions.

The broader source suite was also run with two workers: 222 tests passed and two existing tests failed. The imported-title triple-encoding test used unchanged code; the workspace-loader test also failed with a copy of the pre-feature `main.tsx`. These failures predate this feature. The standalone import-validator fixtures are run with Node, rather than included as a Vitest suite.

After deployment, check that the public catalog has no Brainstorm Genesis tab and that idea catalog/detail deep links require approval without disclosing content. Approved members should see both tabs and full idea content. Authenticated live smoke tests require designated approved applicant and Research accounts: submit one idea, approve it without a team, request to lead, accept it, and confirm proposer credit and only the accepted applicant's membership. Repeat with the own-initiative submission action. The local `smoke-project-ideas.mjs` check uses fictional data and creates no production submissions.

For explicitly authorized production checks using a designated disposable member account, run from `app/`:

```text
node scripts/check-project-ideas-live-setup.mjs
node scripts/prepare-project-ideas-live.mjs --member-email <disposable-email> --temporary-password
```

The preparer creates `setup.sql`, `cleanup.sql`, and `fixture.json` under the git-ignored `smoke-private/project-ideas-<run>/` directory. It creates no hosted data itself and prints only local paths. The administrator runs the complete setup SQL in Supabase SQL Editor. Setup temporarily approves the designated member and, when requested, sets a random test password; it stores the prior password hash and standing in an administrator-only schema for restoration. Alternatively, use `--password-file <private-file>` with an existing password to leave authentication settings unchanged. Two confirmed email/password fixture accounts are created without sending emails, with Research access granted only to the generated reviewer. The preparer generates and verifies bcrypt hashes using the actual pgcrypto extension in local PGlite; hosted SQL contains those hashes and calls no pgcrypto functions. RLS remains enabled.

Then run:

```text
node scripts/smoke-project-ideas-live.mjs ../smoke-private/project-ideas-<run>/fixture.json --probe
node scripts/smoke-project-ideas-live.mjs ../smoke-private/project-ideas-<run>/fixture.json
```

The full check uses legitimate password sessions in an isolated headless Chrome profile to exercise the deployed proposal, catalog, Home, and Research UI. It checks both submission actions, draft/resubmission preservation, member-only ideas, anonymous catalog/detail guards, private applicant notes, declines, suspended-account reads with an existing session, competing requests, retry safety, proposer credit and notifications, exact lead membership, and no immediate HP/reporting. All mutations target exact fixture account IDs and two unique titles authored by the designated member. It never acts on another member's queue entries or starts a reporting cycle. Test sessions are signed out when the script finishes. A private result file records only the fixture IDs and result.

Session changes force a new document load: a hash-only navigation would retain the previous document and skip the new session initializer. Use `--browser-probe` to check authenticated page loading without creating submissions. If a run stops during the draft/submission/changes-requested form stage, `--resume` continues that exact fixture proposal without creating a duplicate. Later stages require completing or cleaning the existing run before preparing another.

Afterward, the administrator runs `cleanup.sql` in SQL Editor, then run:

```text
node scripts/smoke-project-ideas-live.mjs ../smoke-private/project-ideas-<run>/fixture.json --verify-cleanup
```

Cleanup removes the run's proposals, initiatives, memberships, requests, and associated fixture notifications; restores the designated member's authentication and standing; revokes the fixture Research grant; and suspends/bans the two generated accounts. It retains immutable audit records and their referenced identities, and wipes the saved credential backup after restoration. Cleanup refuses to delete projects if other members have applied/joined or if any tasks, HP, documents, or weekly obligations exist. The offline SQL check verifies real password hashing, setup without hosted crypto functions or plaintext passwords, repeated setup/cleanup, restoration, privacy, and these refusal cases.

Authenticated checks against the deployed application passed on October 5, 2026, before migration `027`. They confirmed both full flows, draft/resubmission behavior, proposer credit and private notes, decline feedback, suspended-account rejection, competing applicants, one accepted lead membership, idempotent decisions/notifications, retained idea links and content, and zero immediate HP events or obligations. The operator then applied cleanup; the live check confirmed that both test catalog entries were removed and the temporary credentials were disabled. Cleanup restores the designated member's prior password and standing, and revokes the generated Research grant. RLS remained enabled throughout; immutable audit records are retained by design. After `027`, anonymous cleanup checks verify public initiative removal, denied idea access, and disabled temporary credentials; private proposal deletion is enforced by the administrator cleanup SQL.
