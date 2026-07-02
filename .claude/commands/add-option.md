---
description: Add or change a game option, threading it through all six required sites.
argument-hint: <optionName> — <what it does / default>
---

Add the game option described by: **$ARGUMENTS**

Game options live inside the serialized game state (JSON), so no DB migration is
needed — but an option is only correct when wired through ALL of these. Work
through them in order, showing the edit for each:

1. **`src/game/engine.ts`** — add the field to the `GameOptions` interface and a
   default to `DEFAULT_OPTIONS`.
2. **`src/components/SetupScreen.tsx`** — add the House-Rules toggle/control.
3. **`src/game/config.ts`** — extend `sanitizeOptions`, the ONE shared sanitizer
   both backends import. For a false-default boolean, add it to `BOOL_OPTS`; if
   the default is `true` (like `showLog`), special-case it so the flag can be
   turned off.
4. **The consumer(s)** — wherever the rule/UI actually reads the option (reducer,
   scoring, board rendering). Confirm both boards honor it if it's visible in
   play (see the parity rule in CLAUDE.md).
5. **Type-required literals** — update full `GameOptions` object literals in the
   tests and `src/App.tsx`; TypeScript will flag any you miss.
6. **`npm run build:edge`** — rebuild and commit `engine.mjs`, since `config.ts`
   is bundled into it.

Then run `npm run typecheck && npm run lint && npm test` and report. If the
option changes the client↔server wire contract, stop and ask before bumping
`PROTOCOL_VERSION`. Use a `feat:` commit for a new option.
