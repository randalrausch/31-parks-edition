# Contributing to 31 · National Parks Edition

Thanks for your interest! Contributions of all kinds are welcome — bug fixes,
features, docs, and especially **new park themes** (see
[docs/THEMES.md](docs/THEMES.md)).

## Getting started

Requires **Node 20+** (see `.nvmrc`; `nvm use` picks it up).

```bash
git clone https://github.com/randalrausch/31-parks-edition.git
cd 31-parks-edition
npm install
npm run dev        # solo play works with no further setup → http://localhost:5173
```

Multiplayer is optional; set it up only if you're working on online features
([docs/SUPABASE.md](docs/SUPABASE.md)).

## Before you open a PR

Run the same checks CI runs:

```bash
npm run format:check # Prettier formatting (run `npm run format` to fix)
npm run typecheck    # tsc, no errors
npm run lint         # ESLint, no errors
npm test             # unit + fuzz suite, all green
npm run build        # production build succeeds
npm run test:e2e     # real-browser Playwright suite (CI runs this on every PR)
```

> `npm run test:e2e` drives your locally-installed Google Chrome
> (`playwright.config.ts` uses the `chrome` channel). If you don't have it,
> install it once with `npx playwright install chrome`.

**If you changed anything under `src/game/`**, re‑bundle the shared Edge Function
engine and commit the regenerated bundle — **CI rejects a stale bundle**, so this
is required regardless of which backend (if any) you run:

```bash
npm run build:edge
git diff --exit-code supabase/functions/_shared/engine.mjs  # must be clean after committing
```

Deploying the function (`supabase functions deploy game`) is a separate,
optional step you only need when running your own backend.

## Your first contribution

New here? The friendliest ways in:

- **Add a national park** — mostly art + a palette + one registry entry, no code
  required for the easy path. Start with [docs/THEMES.md](docs/THEMES.md) and the
  [New theme issue form](https://github.com/randalrausch/31-parks-edition/issues/new?template=new_theme.yml).
- **Contribute art** — opponent portraits, park scenes, card backs (see the
  READMEs in `src/assets/`).
- **Add or tune an AI opponent** — one entry in `src/game/aiCharacters.ts`.
- **Pick up a labeled issue** — browse
  [`good first issue`](https://github.com/randalrausch/31-parks-edition/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  and [`help wanted`](https://github.com/randalrausch/31-parks-edition/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

See the [ROADMAP](ROADMAP.md) for where things are headed. Comment on an issue to
claim it, and don't hesitate to open a draft PR early for feedback.

## Project conventions

- **Keep the game core pure.** `src/game/engine.ts`, `actions.ts`, and
  `authority.ts` must stay free of React, the DOM, timers, sound, and network —
  they're shared by the client *and* the server, and are what the tests cover.
  Presentation concerns belong in `useGame.ts` / components.
- **Add tests for logic changes.** Anything in the pure core should have or
  extend a `*.test.ts`. Fuzz/invariant tests are encouraged for rules changes.
- **Match the surrounding style.** TypeScript strict mode; comments explain
  *why*, not *what*. Formatting is handled by Prettier (`npm run format`) and
  checked in CI (`npm run format:check`).
- **Hidden information is sacred.** Never send a player another player's cards.
  The server `redactState` enforces this; keep it that way.
- **Keep the two boards and two backend adapters in parity.** The game has two
  front‑end boards (`src/components/GameBoard.tsx` solo, `OnlineGameBoard.tsx`
  online) and two backend store adapters (`src/game/supabaseStore.ts`,
  `api/src/game/tableStore.ts`). When you change one, change or verify its
  sibling — a feature that lands in only one is the project's most common bug.
  Shared board UI belongs in `src/components/BoardParts.tsx` (an ESLint rule
  forbids the two boards importing each other). Run `/parity-check` if you use
  Claude Code.

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
- prepends `CHANGELOG.md`, opens a `chore(release): vX.Y.Z` PR with that change,
  waits for it to go green, merges it, then tags `vX.Y.Z` and publishes a
  GitHub Release. Going through a PR (rather than pushing straight to `main`)
  is what lets this work under ordinary branch protection — a required status
  check can only ever pass for a commit GitHub already knows about, which rules
  out a bare `git push` of a brand-new commit.

If it can't tell what bump your commits imply, it opens an issue asking you to
decide rather than guessing. Preview locally with `node scripts/release.mjs --dry`.

`PROTOCOL_VERSION` is the exception: bump it **by hand** in `version.ts` only when
you change the client↔server wire contract incompatibly (op surface, redacted
state shape, seat‑token semantics). A client on a different protocol than the live
backend is asked to refresh. Bumping it (or any `src/game/` change) needs
`npm run build:edge` re‑run and committed.

`STATE_VERSION` (also in `version.ts`) is a sibling manual bump: raise it **only**
when a change to the `GameState` shape makes an older serialized game unreadable
by the current engine. The server stamps it into every new game and rejects a
stored game whose version doesn't match (a clear "started on an older version"
message instead of a crash), so in‑flight games can't silently break across such a
deploy. A pure additive field usually does **not** need a bump.

## Reporting bugs / requesting features

Use the issue templates. For a new theme idea, the **New theme** issue template
helps you gather the art and palette before you start.

## Code of conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).
