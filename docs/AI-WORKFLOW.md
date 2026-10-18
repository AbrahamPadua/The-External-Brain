# AI workflow

How changes get made with Claude Code in this repo. The agent rules are in `AGENTS.md`; this file is for the human driving.

## Every feature

1. **Fresh start.** `/clear`, then `git switch -c feat/<name>` (or ask Claude to work in a worktree).
2. **Plan.** `/grill-with-docs <what you want>`. Answer until the plan is unambiguous. If it is bigger than an afternoon, `/to-spec` then `/to-tickets` and do one ticket per session.
3. **Build in slices.** `/tdd` for logic: failing test first, then code. For UI: `/impeccable critique <screen>`, fix, then `/impeccable polish`.
4. **Automatic check.** Every time Claude finishes, the Stop hook runs the build and affected tests (and the database check if migrations changed). Red blocks Claude until it is fixed.
5. **Look at it.** UI changes: run the `verify-ui` skill and open the screenshots yourself.
6. **Cut bloat.** `/ponytail-review` on the diff. Accept deletions, question additions.
7. **Review in fresh context.** `/code-review`. For auth, RLS, migrations or diffs over about 200 lines, also `second-opinion` (Gemini through AGY). Fix real findings only.
8. **You read.** Every migration, RLS policy, auth or permission change, and every test that was modified or deleted. Skim the rest.
9. **Ship.** Commit specific files, push, `gh pr create`, wait for CI, merge.

## Rules of thumb

- One task per session. Long sessions drift; `/clear` is cheap.
- Parallel agents only for independent work, each in its own worktree. Never two agents in `App.tsx` at once.
- If Claude makes the same mistake twice, add one line to `AGENTS.md`.
- Never let an agent decide a test is wrong. It explains, you decide.

## Weekly (20 minutes)

- `/improve-codebase-architecture` on `app/src/App.tsx`: move one screen into its own file per session, tests green before and after.
- Prune `AGENTS.md` to what still matters. Under 60 lines.
- Update Claude Code and plugins.
