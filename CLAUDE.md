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

**Back ends (keep in feature parity):**
- Supabase Edge Function — `supabase/functions/game/index.ts`
- Azure Functions — `api/src/game/handlers.ts`

Both back ends run the SAME shared engine:
- Supabase bundles it via `src/game/edgeEntry.ts` → `supabase/functions/_shared/engine.mjs`
  (rebuild with `npm run build:edge` whenever shared engine/actions/authority
  code changes, and commit the regenerated `engine.mjs`).
- Azure imports the source directly (`api/src/game/engine.ts` re-exports `edgeEntry`).

> **Parity rule:** any change to one back end almost always needs the matching
> change in the other. The same is true for the two front-end boards. When you
> touch one, check the sibling.

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
