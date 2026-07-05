---
description: Run the full pre-commit gate (format, typecheck, lint, tests, build) and verify the edge bundle is in sync.
allowed-tools: Bash(npm run check), Bash(npm run format:check), Bash(npm run typecheck), Bash(npm run lint), Bash(npm test), Bash(npm run build), Bash(npm run build:edge), Bash(npm run edge:check), Bash(npm run api:typecheck), Bash(npm run api:test), Bash(git status:*), Bash(git diff:*)
---

Run this repo's full pre-commit gate and report a concise pass/fail summary. Do
NOT commit anything — this only verifies.

Run, in order, and capture results:

1. `npm run format:check` — Prettier; CI's gate fails on drift (`npm run
   format` fixes it).
2. `npm run typecheck`
3. `npm run lint` — also enforces the boards not importing each other.
4. `npm test` — full vitest suite.
5. `npm run build` — production build.

(Steps 1–5 are exactly `npm run check`; run that as one step if you prefer, and
fall back to the individual commands only to isolate a failure.)

6. `npm run api:typecheck` and `npm run api:test` — the Azure package. NOTE:
   pre-existing `@azure/*` "module not found" errors when its deps aren't
   installed are expected; ignore ONLY those, flag any other new error.
7. **Edge-bundle sync check:** run `npm run edge:check` (rebuilds `engine.mjs`
   and diffs it against the committed copy). If it fails, the shared `src/game/`
   layer changed but the committed bundle is stale — call this out as a required
   fix (the change must include the regenerated `engine.mjs`).

Summarize each step as pass/fail with the key error lines for any failure, and
end with a clear "ready to commit" / "not ready — fix X" verdict. If a
Conventional Commit type is relevant to what changed, suggest the right one
(feat/fix/perf/refactor/docs/chore/test) per CLAUDE.md.
