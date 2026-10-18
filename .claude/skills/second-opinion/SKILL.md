---
name: second-opinion
description: Get an independent review of the current diff from Gemini through the AGY CLI. Use after /code-review for changes to auth, permissions, RLS or migrations, or any diff over about 200 lines.
---

# Second opinion (cross-model review)

A different model catches different mistakes. This reuses the repo's AGY helper, which sends text only and gives Gemini no file or shell access.

1. Write the diff to `$TEMP/teb-review.diff`: `git diff HEAD`, then append each new untracked file from `git status` with `git diff --no-index /dev/null <file>`.
2. The helper passes everything on the command line, which Windows caps near 32 KB. If the diff is larger, split it by file and run step 4 once per part.
3. Write this prompt to `$TEMP/teb-review-prompt.md`:

   > You are a senior reviewer for The External Brain (React 19, TypeScript, Vite, Supabase with RLS). The project rules are in AGENTS.md below. Review the diff. Report only real problems: bugs, security or RLS holes, data leaks between members, missing or weakened tests, unhandled edge cases, and needless complexity or duplication. For each: file and line, the problem, why it matters, the fix. No praise and no style nits. If there is nothing important, reply "No blocking issues."

4. From the repo root: `node app/scripts/ui-agent-packet.mjs "$TEMP/teb-review-prompt.md" "$TEMP/teb-review-result.md" "$TEMP/teb-review.diff" AGENTS.md`
5. Read the result. Check every finding against the actual code before acting; reviewers are often wrong. Fix the real ones.
6. Report each finding as accepted (with the fix) or rejected (with the reason).
