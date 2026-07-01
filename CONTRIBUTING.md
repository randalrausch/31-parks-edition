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

- Write [**Conventional Commit**](https://www.conventionalcommits.org/) messages
  — the release automation reads them (see below). Use `feat:` for a feature,
  `fix:` for a bug fix, `perf:` for a performance fix, and add `!` (or a
  `BREAKING CHANGE:` footer) for a breaking change; `chore/docs/refactor/test/ci`
  for everything else. This repo squash‑merges, so the **PR title** becomes the
  commit — make it a Conventional Commit too.
- One logical change per PR where practical; include test updates.
- Describe what you changed and how you verified it.

## Versioning & releases

Versions are automated — you don't hand‑edit them. The single source is
`src/game/version.ts` (`APP_VERSION` + `PROTOCOL_VERSION`), read by the frontend
and both backends. On every push to `main`, `.github/workflows/release.yml`:

- bumps the version from the Conventional Commits since the last tag
  (`feat` → minor, `fix`/`perf` → patch, breaking → major; a breaking change
  while pre‑1.0 bumps the minor, so you never hit `1.0.0` by accident),
- prepends `CHANGELOG.md`, tags `vX.Y.Z`, and publishes a GitHub Release.

If it can't tell what bump your commits imply, it opens an issue asking you to
decide rather than guessing. Preview locally with `node scripts/release.mjs --dry`.

`PROTOCOL_VERSION` is the exception: bump it **by hand** in `version.ts` only when
you change the client↔server wire contract incompatibly (op surface, redacted
state shape, seat‑token semantics). A client on a different protocol than the live
backend is asked to refresh. Bumping it (or any `src/game/` change) needs
`npm run build:edge` re‑run and committed.

## Reporting bugs / requesting features

Use the issue templates. For a new theme idea, the **New theme** issue template
helps you gather the art and palette before you start.

## Code of conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).
