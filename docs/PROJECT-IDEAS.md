# Project ideas and requests to lead

The shared **New project proposal** form has identical fields and requirements for both purposes. Saving a draft retains its content and stored purpose. The explicit **Submit a project idea** or **Submit to lead this project** action chooses the submitted purpose; Enter in the form does not choose either action. Research can approve, decline, or request changes with feedback.

`proposals.purpose` is `own_initiative` by default for existing proposals, or `project_idea`. The `save_proposal(text,text,jsonb,boolean,uuid)` signature is unchanged. Supply purpose in `p_content.purpose`; invalid purposes are rejected, and omitting it on an edit preserves the stored purpose. Submitted and approved proposals cannot be edited.

Approval of an own initiative retains the existing initiative/lead-membership behavior. Idea approval only publishes the proposal; it creates no initiative, membership, HP event, or obligation. A proposer can later apply to lead their own approved idea.

## Catalog and access

- `#/catalog` and `#/catalog/initiatives` show Initiatives by default.
- `#/catalog/project-ideas` shows available approved ideas using the shared search, discipline filters, and alphabetical sorting.
- `#/project-idea/<proposal-id>` shows the approved abstract, plan, motivation, and proposer credit. Taken ideas remain reachable and link to their resulting initiative.
- `project_idea_catalog` is publicly readable and contains only display content, proposer ID/display name, and resulting initiative ID. Raw proposals and review feedback keep their existing private policies.
- `idea_lead_requests` reads are limited to approved applicants reading their own requests and approved Research-authorized accounts. Operations alone cannot see applicant notes or decide them. Admin satisfies the existing Research role check.

## Lead-request commands

`request_idea_lead(p_proposal uuid,p_message text)` requires a currently approved account, an available approved idea, and a 10–2000 character interest/availability note. Multiple people may apply. A partial unique index permits one pending request per applicant/idea. A repeated pending application returns the existing request, and declined applicants can apply again.

`decide_idea_lead(p_request uuid,p_approve boolean,p_reason text)` requires Research. Decline requires feedback. Acceptance rechecks and locks the applicant's approved standing, copies the approved proposal into an active initiative, and adds only the applicant as the lead/first member. The original proposal and proposer credit are retained. The plan is stored separately from the abstract, matching migration `025`.

Both commands acquire the proposal lock first. The existing unique `initiatives.proposal_id` constraint also enforces one initiative per idea. Other pending requests become `taken` (**Taken up by another member**), with their own notifications and audit decisions. Retries of successful decisions do not add memberships, notifications, or audit entries. The proposer is notified when the idea starts. There are no immediate HP or weekly obligations: the existing `activated_at`/Los Angeles weekly-cycle rules apply to the new initiative.

Stopping an initiative does not reopen the idea. Approved idea editing and parallel copies are outside this version.

## Verification and rollout

Apply migrations `025` and `026` as complete transactions before publishing the frontend. The operator reported both applied on October 4, 2026; `check-project-ideas-live.mjs` then confirmed the public view columns and anonymous applicant-note denial using the frontend public key. It makes no hosted mutations and prints no configuration values.

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

`check-project-ideas.mjs` executes actual PostgreSQL migrations offline through PGlite. It checks upgrade preservation, older-client edits, private drafts/notes, public projection shape, Research/account boundaries, competing applicants, duplicate requests, repeated decisions, suspended applicants, decline feedback, proposer applications, content/credit preservation, and next-cycle activation.

For full browser flows, start Vite on `127.0.0.1:5174` and run `node scripts/smoke-project-ideas.mjs` with the installed Chrome on Windows. This uses the fictional development fixture, creates isolated headless browser state, tests both complete approval paths, actual Enter-key behavior, private lead notes and competing applicants, and captures mobile/desktop screenshots under the system temporary directory. It performs no production submissions.

The broader source suite was also run with two workers: 222 tests passed and two existing tests failed. The imported-title triple-encoding test used unchanged code; the workspace-loader test also failed with a copy of the pre-feature `main.tsx`. These failures predate this feature. The standalone import-validator fixtures are run with Node, rather than included as a Vitest suite.

After deployment, check the live public catalog tabs and idea deep links. Authenticated live smoke tests require designated approved applicant and Research accounts: submit one idea, approve it without a team, request to lead, accept it, and confirm proposer credit and only the accepted applicant's membership. Repeat with the own-initiative submission action. The automated complete-flow smoke tests use fictional local data; no real-member submissions are created by these scripts.
