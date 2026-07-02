---
description: Run the full pre-commit gate (typecheck, lint, tests, build) and verify the edge bundle is in sync.
allowed-tools: Bash(npm run typecheck), Bash(npm run lint), Bash(npm test), Bash(npm run build), Bash(npm run build:edge), Bash(npm run api:typecheck), Bash(npm run api:test), Bash(git status:*), Bash(git diff:*)
---

Run this repo's full pre-commit gate and report a concise pass/fail summary. Do
NOT commit anything — this only verifies.

Run, in order, and capture results:

1. `npm run typecheck`
2. `npm run lint` — also enforces the boards not importing each other.
3. `npm test` — full vitest suite.
4. `npm run build` — production build.
5. `npm run api:typecheck` and `npm run api:test` — the Azure package. NOTE:
   pre-existing `@azure/*` "module not found" errors when its deps aren't
   installed are expected; ignore ONLY those, flag any other new error.
6. **Edge-bundle sync check:** run `npm run build:edge`, then `git status
   --short supabase/functions/_shared/engine.mjs`. If it shows as modified, the
   shared `src/game/` layer changed but the committed bundle is stale — call this
   out as a required fix (the change must include the regenerated `engine.mjs`).

Summarize each step as pass/fail with the key error lines for any failure, and
end with a clear "ready to commit" / "not ready — fix X" verdict. If a
Conventional Commit type is relevant to what changed, suggest the right one
(feat/fix/perf/refactor/docs/chore/test) per CLAUDE.md.
