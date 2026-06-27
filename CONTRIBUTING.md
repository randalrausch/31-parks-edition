# Contributing to 31 · National Parks Edition

Thanks for your interest! Contributions of all kinds are welcome — bug fixes,
features, docs, and especially **new park themes** (see
[docs/THEMES.md](docs/THEMES.md)).

## Getting started

```bash
npm install
npm run dev        # solo play works with no further setup
```

Multiplayer is optional; set it up only if you're working on online features
([docs/SUPABASE.md](docs/SUPABASE.md)).

## Before you open a PR

Run the same checks CI runs:

```bash
npm run typecheck   # tsc, no errors
npm test            # unit + fuzz suite, all green
npm run build       # production build succeeds
```

If you changed shared game logic in `src/game/` and use the Supabase backend,
also re‑bundle the Edge Function engine and redeploy:

```bash
npm run build:edge
supabase functions deploy game
```

## Project conventions

- **Keep the game core pure.** `src/game/engine.ts`, `actions.ts`, and
  `authority.ts` must stay free of React, the DOM, timers, sound, and network —
  they're shared by the client *and* the server, and are what the tests cover.
  Presentation concerns belong in `useGame.ts` / components.
- **Add tests for logic changes.** Anything in the pure core should have or
  extend a `*.test.ts`. Fuzz/invariant tests are encouraged for rules changes.
- **Match the surrounding style.** TypeScript strict mode; comments explain
  *why*, not *what*. Prettier is used for formatting.
- **Hidden information is sacred.** Never send a player another player's cards.
  The server `redactState` enforces this; keep it that way.

## Commit & PR

- Write clear, present‑tense commit messages describing the change and its
  rationale.
- One logical change per PR where practical; include test updates.
- Describe what you changed and how you verified it.

## Reporting bugs / requesting features

Use the issue templates. For a new theme idea, the **New theme** issue template
helps you gather the art and palette before you start.

## Code of conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).
