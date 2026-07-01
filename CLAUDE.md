# Project guide for Claude

## Architecture: one rules engine, two front ends, two back ends

The game **rules live in one place** — `src/game/` (`engine.ts`, `actions.ts`,
`authority.ts`). Everything else consumes them. Never fork or duplicate rules
logic; change it once here.

**Front ends (keep in feature parity):**
- Solo / pass-and-play — `src/components/GameBoard.tsx`
- Online — `src/components/OnlineGameBoard.tsx`
- Shared board pieces live in `src/components/BoardParts.tsx`. Put anything both
  boards render there rather than copying it.

**Back ends — both run the SAME shared op layer in `src/game/`:**
the five ops (`handlers.ts`), the request router + CORS + per-instance rate limit
(`router.ts`), the durable rate-limit bucketing (`rateLimit.ts`), the `GameStore`
interface (`store.ts`), and ids (`ids.ts`) — on top of the rules engine. Each
backend supplies only a `GameStore` + rate-limiter **adapter** and a request
marshaling shim; the ops/router/redaction are shared, so they can't drift.
- Supabase Edge Function — `supabase/functions/game/index.ts`: a thin Deno adapter
  that builds a `SupabaseGameStore` (`src/game/supabaseStore.ts`) and calls
  `makeRouter`. It imports the shared layer from the bundle: `src/game/edgeEntry.ts`
  → `supabase/functions/_shared/engine.mjs` (rebuild with `npm run build:edge`
  whenever any shared `src/game/` code changes, and commit the regenerated
  `engine.mjs`).
- Azure Functions — `api/src/index.ts`: imports the same `makeRouter` and shared
  modules directly from `src/game/`, backed by `TableGameStore`
  (`api/src/game/tableStore.ts`). Only Table Storage-specific code lives in `api/`.

> **Parity rule:** the op layer is now shared, so most backend changes land once
> in `src/game/`. What still differs is each backend's **store/rate-limiter
> adapter** (`supabaseStore.ts` vs `tableStore.ts` + `api/src/game/rateLimit.ts`)
> and its entry shim — when you touch one adapter, check the sibling. The same
> parity discipline applies to the two front-end boards.

## Adding or changing a game option

Game options (`GameOptions` in `src/game/engine.ts`) flow through several places.
To add one, update ALL of:
1. `GameOptions` interface + `DEFAULT_OPTIONS` — `src/game/engine.ts`
2. The setup toggle — `src/components/SetupScreen.tsx` (House Rules)
3. `sanitizeOptions` in **`src/game/config.ts`** — the ONE shared sanitizer both
   backends import (add to `BOOL_OPTS` for a false-default flag; special-case it
   if the default is true, like `showLog`). Because both the Supabase Edge
   Function and the Azure handlers call `buildCreateSetup` from this module,
   there is no second copy to keep in sync.
4. Wherever the option is consumed (board UI, reducer, etc.)
5. Full `GameOptions` literals in tests + `src/App.tsx` (TypeScript will flag
   the missing field).
6. Rebuild `engine.mjs` (`npm run build:edge`) — `config.ts` is bundled into it,
   so any change here needs the edge bundle regenerated and committed.

Options are stored inside the serialized game state (JSON), not as DB columns —
no migration needed for a new option.

## Checks before committing
- `npm run typecheck` (app) and `cd api && npm run typecheck` (the Azure package
  has pre-existing `@azure/*` "module not found" errors when its deps aren't
  installed — ignore those, but no other new errors).
- `npm run lint` (ESLint; also enforces that the two boards don't import each
  other — shared UI belongs in `BoardParts`).
- `npm run test` (full vitest suite)
- `npm run build` (production build)

## Versioning & releases

**One version source:** `src/game/version.ts` exports `APP_VERSION` (human
semver) and `PROTOCOL_VERSION` (wire contract). The frontend (via `vite.config.ts`)
and both backends (via the bundled `engine.mjs` / direct import) all read it, so
they can never report different releases. `APP_VERSION` is maintained
**automatically** — do not hand-edit it.

**Commits drive the version.** Write [Conventional Commits](https://www.conventionalcommits.org/):
`feat: …` (→ minor), `fix:`/`perf: …` (→ patch), `feat!:` or a `BREAKING CHANGE:`
footer (→ major; while pre-1.0 that's a minor bump, never an accidental 1.0.0).
`chore/docs/refactor/test/ci/style` don't trigger a release. On push to `main`,
`.github/workflows/release.yml` runs `scripts/release.mjs`: it bumps
`APP_VERSION`, prepends `CHANGELOG.md`, rebuilds `engine.mjs`, tags `vX.Y.Z`, and
publishes a GitHub Release. If it can't classify the commits, it opens an issue
asking a human instead of guessing — so **pick the right commit type**, and if
you're unsure whether a change is release-worthy or breaking, ask.

**`PROTOCOL_VERSION` is manual.** Bump it (in `version.ts`) ONLY when the
client↔server wire contract changes incompatibly — the op surface, the
`redactState` shape, or seat-token semantics. A client whose `PROTOCOL_VERSION`
differs from the live backend's is told to refresh (`OnlineRoot` / About). When a
change to `src/game/` might be a protocol break and you're not certain, ask
before committing rather than risk silently breaking live games. Bumping it means
rebuilding `engine.mjs`.
