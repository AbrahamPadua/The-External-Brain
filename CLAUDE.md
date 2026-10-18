@AGENTS.md

## Claude Code

- A Stop hook (`.claude/hooks/verify-on-stop.mjs`) runs the build and affected tests when you finish a turn with app changes, plus the database check when migrations change. If it blocks you, fix the cause.
- Before calling UI work done, run the `verify-ui` skill. For auth, RLS, migration or large changes, run `second-opinion` after `/code-review`.
- Use subagents for wide searches so the main context stays small.
