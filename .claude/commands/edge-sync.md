---
description: Rebuild the Supabase edge bundle (engine.mjs) and report whether it changed so it can be committed.
allowed-tools: Bash(npm run build:edge), Bash(git status:*), Bash(git diff:*)
---

The Supabase Edge Function runs a bundled copy of the shared `src/game/` layer at
`supabase/functions/_shared/engine.mjs`. It must be regenerated and committed
whenever any bundled `src/game/` module changes, or the two backends drift.

Do this:

1. Run `npm run build:edge`.
2. Run `git status --short supabase/functions/_shared/engine.mjs`.
3. If the bundle changed, report that it now needs to be committed alongside the
   source change (and remind that a `PROTOCOL_VERSION` bump, if the wire contract
   changed, also requires this rebuild). If it did not change, confirm the bundle
   was already in sync.

Do not commit — just rebuild and report.
