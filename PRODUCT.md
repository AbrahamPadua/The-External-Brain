# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are members of the Neuro Network UCSD research lab, mostly undergraduate research assistants, working alongside graduate students and lab leadership:

- **Members** propose and lead initiatives (research projects), submit weekly reporting memos (RMs), complete tasks, review peers' RMs, and browse/apply to lead ideas from the member-only "Brainstorm Genesis" catalog.
- **Initiative leads** additionally manage their initiative's team, tasks, and cover/presentation details.
- **Research** (lab leadership) approves accounts, decides on proposals and idea-lead requests, assigns reviewers, adjusts HP, and opens/manages weekly cycles.
- **Operations** (lab administrators) approves accounts and manages roles, but does not see idea-lead applicant notes or decide them.
- Prospective/public visitors can browse the public initiative catalog without an account.

## Product Purpose

The External Brain is Neuro Network UCSD's internal system of record for running the lab's research initiatives end to end: account approval, initiative proposals, weekly reporting cycles, peer review, task tracking, and an internal catalog of ideas members can apply to lead. Success means the lab's actual weekly reporting/review rhythm and HP-based accountability run correctly and verifiably, with no record leaking to accounts that haven't been approved for it.

## Positioning

Built and tuned specifically for this one lab's existing workflow and vocabulary (RM cycles, HP, Operations vs. Research roles, obligations, initiatives) rather than as a generic, multi-tenant lab-management product. There is no near-term goal of other labs adopting it, so terminology and permission rules can stay lab-specific rather than generalized.

Its meaningfully different mechanism versus a generic project tool: every privileged state change goes through backend RPC functions enforced by Supabase row-level security (never client-side trust), so approval status, role, and initiative membership gate what data a signed-in member can even fetch, not just what the UI shows them.

## Operating Context

- Deployed as a static React/TypeScript single-page app on GitHub Pages, using hash-based routing, talking to a Supabase Postgres backend via the publishable/anon key only.
- Weekly reporting cycles run Monday-anchored in America/Los_Angeles, processed either by `supabase/schedule.sql` or Research manually calling `open_cycle`/`evaluate_due_obligations`.
- New sign-ups land as `pending` until Operations or Research approves them; account approval, email verification, and initiative participation are three separate gates.
- Without Supabase environment configuration, the app runs on a visibly labeled, browser-only fictional demo dataset, never a production identity/permission system.
- Initiative lifecycle: a proposal (own-initiative or Brainstorm Genesis idea) is submitted, Research approves/declines/requests changes, and approval creates the initiative and lead membership (directly, or via an idea-lead request Research accepts).
- Each cycle, responsible members submit an RM (reporting memo); other initiatives' members may be assigned to review a submitted RM, with conflict-of-interest checks re-run at submission time.

## Capabilities and Constraints

- HP ("health points", 0–100) measures reporting reliability, not scientific quality: missed deadlines deduct points, on-time submission earns a configured reward and reverses prior late penalties, and Research can manually adjust HP with a recorded reason.
- Sign-in is password-first: returning members sign in with email and password (8+ characters). New members verify their email by link and then set a password, and an email link also sets or resets a forgotten password.
- Rich-text documents (RMs, proposals) use a Tiptap-based editor; `document_versions` are immutable once submitted, and drafts use revision-checked saves to avoid clobbering concurrent edits.
- `initiative-images` storage is private and scoped by initiative UUID path segment; readable by current initiative participants and accounts holding a live review obligation against that initiative, not by Operations/Research as a blanket grant.
- A service-role key must never be used in a Vite/browser environment variable; only the publishable/anon key is exposed client-side.
- Brainstorm Genesis (the project-idea catalog) and its idea detail pages are visible only to signed-in, currently approved members; public initiative pages omit the originating idea reference.
- The GitHub Pages publish workflow has a prebuild guard that refuses to deploy if the Supabase URL/anon-key repository variables are missing or malformed, so the fictional demo data can never ship as if it were live.

## Brand Commitments

- Product name: **The External Brain**, serving the Neuro Network UCSD research lab. "Open Labs" appears in one planning doc (`docs/PRODUCT-BACKLOG.md`) as a stale/internal label and is not the product's name going forward.
- "Brainstorm Genesis" is the current, confirmed name for the member-only idea catalog (previously called "Project ideas"); existing routes, stored purpose values, and RPC/database names remain compatible under the old name.

## Evidence on Hand

No real member data, credentials, testimonials, or case studies belong in this repository or product. The only content available for design/demo purposes is the visibly labeled fictional local demo dataset used when Supabase env vars are absent; it is browser-only and must never be presented as real.

## Product Principles

1. Backend enforcement over UI trust: every privileged transition (approval, role grant, review assignment, document submission) goes through an RPC/RLS-checked path, so the UI never needs to recreate the authorization logic to stay safe.
2. Reporting integrity over convenience: immutable submitted versions, revision-checked drafts, and retry-safe/idempotent scheduled penalty evaluation exist so the weekly accountability record can't be silently altered or double-charged.
3. Approval status is layered, not binary: email verification, account approval, and initiative participation are independently gated, and future work should keep them separable rather than collapsing them into one "signed in" state.
4. Built for this lab, not for resale: terminology, roles, and workflow stay specific to Neuro Network UCSD's actual process rather than generalized for other labs.
5. No fabricated content ships: demo data stays visibly fictional and confined to the browser; real testimonials, benchmarks, or sample content are never invented to fill gaps.

## Accessibility & Inclusion

- Every screen works in both dark and light themes (persistent toggle, system-preference default).
- Every screen is usable at 390px phone width; members use the app on phones.
- Animation is expressive by design (the owner wants "some cool animations"). Members who turn on reduced motion get still versions of the big moments, such as the RM submit reward.
