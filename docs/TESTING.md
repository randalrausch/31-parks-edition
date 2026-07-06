# Testing strategy

The project is tested in layers, cheapest and fastest first. Every guarantee the
docs make is meant to be backed by a test that runs in CI.

## 1. Unit / fuzz — `npm test` (Vitest)

Co-located `*.test.ts` next to the code. This is where the rules engine,
redaction, store adapters, rate limiting, and reconnect logic are pinned.

- **Rules engine** (`engine.test.ts`, `actions.test.ts`) — scoring, token/Grace
  damage, and property/fuzz tests that play hundreds of random games asserting
  invariants: 52-card conservation, clean elimination, monotonic tokens,
  termination, exactly one winner (or a draw on simultaneous final elimination).
- **Hidden information** (`redactFuzz.test.ts`, `multiplayer.test.ts`) — no seat
  or spectator ever receives another player's cards or the deck across random
  games; hands reveal only at natural table-reveal phases.
- **Shared op layer** (`handlers.test.ts`, `router.test.ts`) — the five ops and
  the router (dispatch, CORS, rate limiting) against `MemoryGameStore` with the
  real engine. Locks the wire shapes and authority rules (host-only start, no-op
  detection, code-collision retry).
- **Store adapters** — Supabase via a fake supabase-js client
  (`supabaseStore.test.ts`); Azure against **Azurite** (`tableStore.test.ts`,
  `rateLimit.test.ts` in `api/`). These pin the atomic compare-and-set and
  create-atomicity contracts. In CI, `TABLES_CONNECTION` is set and Azurite is
  started, and the suite **fails** (not skips) if the emulator is unreachable, so
  the CAS guarantee can't silently rot. Locally, a run without
  `TABLES_CONNECTION` skips them.
- **Security invariants** — `supabase/schema.grants.test.ts` fails if any
  `SECURITY DEFINER` RPC in the `public` schema is missing its `revoke execute
  … from anon`; `clientIp.test.ts` pins spoof-resistant IP parsing.
- **Version-bump tripwires** — the two manual version judgments each have a
  test that makes forgetting them visible. `wireShape.test.ts` snapshots the
  TYPE-SHAPE of every op response and redacted view: if the snapshot diffs,
  that's a wire-contract change — decide whether it needs a `PROTOCOL_VERSION`
  bump before updating it. `stateFixture.test.ts` keeps a committed mid-game
  state serialized at the current `STATE_VERSION` and proves the engine can
  still read, redact, and advance it — if it breaks, your change would strand
  in-flight online games: make it backward-compatible or bump `STATE_VERSION`
  and regenerate (`npm run fixture:state`).

The fuzz suites read two env knobs (see `src/game/fuzzRig.ts`): `FUZZ_SCALE`
multiplies iteration counts and `FUZZ_SEED` seeds the PRNG (default fixed, so
PR runs are deterministic and can't flake). The **nightly deep-fuzz workflow**
runs them at 50× with a fresh seed per night and files an issue with the
reproducing seed on failure: `FUZZ_SEED=<seed> FUZZ_SCALE=50 npm test`.

Run `npm run test:coverage` for a V8 coverage report.

### Mutation audit — `npm run test:mutation` (Stryker, periodic)

Mutation testing is the honest check on coverage *quality*: it mutates the
rules core (`engine.ts`, `actions.ts`, `authority.ts` — see
`stryker.config.json`) and reports any mutant the suites fail to kill, i.e.
logic a test executes but never actually asserts. It takes tens of minutes, so
it is deliberately **not** in CI — run it locally after substantive rules
changes, or every few months, and add tests for survivors that represent real
wrong-game-result bugs (some survivors are benign equivalents; judge them).
The HTML report lands in `reports/mutation/`.

## 2. E2E, local build — `npm run test:e2e` (Playwright)

Builds and serves the production bundle, then plays a real browser through:

- **the solo flow and dialogs** (`e2e/game.spec.ts`);
- **an automated accessibility scan** (`e2e/a11y.spec.ts`) — axe-core against
  WCAG 2.1 A/AA on the setup screen, the in-game board, the join-by-code
  screen, and the online lobby (the online screens are reachable thanks to the
  local backend), failing on `serious`/`critical` violations;
- **a two-browser online round** (`e2e/online.spec.ts`) against a **local
  in-memory backend** (`e2e/localServer.ts` — the same shared op layer both
  production backends run, started automatically by Playwright). Host creates,
  guest joins by code, host starts, a turn is taken — so online/board
  regressions fail at PR time, not after a deploy. The `test:e2e` build uses
  `--mode e2e`, which bakes the local server in as the backend (`.env.e2e`).

Uses your installed Google Chrome (`playwright.config.ts` `channel: "chrome"`);
install it with `npx playwright install chrome` if needed, or point
`PW_EXECUTABLE_PATH` at any Chromium binary. Runs in CI on every push/PR.

## 3. Deployment smoke, live site — `npm run test:e2e:deploy`

Drives a real browser against a **deployed** URL and actually plays it
(`e2e/deployment.spec.ts`): boots + version, a solo turn, and a **two-browser
online round** (host creates a room → second browser joins by code → host starts
→ a turn is taken) against the live backend, proving create/join/start/act and
per-seat hand redaction end to end.

```sh
E2E_BASE_URL=https://play31.fun npm run test:e2e:deploy
```

Runs automatically post-deploy in the Azure workflow against the `AZURE_SITE_URL`
repo variable, and on demand via the `/deploy-smoke <url>` command. Requires
network egress to the target host.

## What each layer deliberately does NOT cover

- **Component/hook rendering.** `useGame` and most React components have no
  unit tests today (`useNetworkGame` has hook-level tests); their behavior is
  covered through the Playwright flows. Extracting the presentation sequencing
  into a framework-free state machine (unit-testable with fake timers) is
  tracked as future work.
- **Load / soak.** There is no automated load test of the `act` path.

## Before you open a PR

```bash
npm run check      # format check + typecheck + lint + unit tests + build
npm run test:e2e   # real-browser E2E (CI runs this on every PR)
# If you touched src/game/, re-bundle the edge engine and commit it:
npm run edge:check
```

`npm run check:all` runs all of the above plus the Azure api suite in one go.
The `/precommit` command does the same and reports a pass/fail summary.
