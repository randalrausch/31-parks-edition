# Architecture

The guiding idea: **the rules are pure, serializable TypeScript** with no
framework, DOM, timing, sound, or network. The same logic runs in the browser
for solo play and on the server for multiplayer. Everything else is a thin layer
around that core.

The server is pluggable: online play runs on **either** a Supabase Edge Function
(`supabase/functions/game`) **or** an Azure Functions app (`api/`) — the client
auto-selects one from environment variables. Both are thin adapters over the
*same* shared authority (`src/game/authority.ts`); Supabase bundles it into
`supabase/functions/_shared/engine.mjs` via `npm run build:edge`, while Azure
imports the source directly. Neither backend forks the rules. This doc says
"the Edge Function" for brevity, but every authority statement applies equally to
the Azure path.

## Terminology

`Game ▸ Deal ▸ Round ▸ Turn`

- **Turn** — one player acts (draw one card, discard one).
- **Round** — one lap of the table (every active player takes a turn).
- **Deal** — one hand dealt out, played over several rounds, until someone knocks
  (or shows 31); then hands are revealed and the lowest loses a token.
- **Game** — successive deals until one player has tokens left — the winner.

("Hand" always means the cards a player holds, never the deal‑cycle.)

## Layers

```text
            ┌─────────────────────────────────────────────┐
            │  Pure core (src/game) — no React/DOM/net     │
            │                                             │
   engine.ts ─ rules: scoring, tokens/grace, AI traits    │
   actions.ts ─ applyAction(state, action) → state  ◄── the authority
   authority.ts ─ redactState / advanceAuthority /        │
                  applyPlayerAction (server brain)         │
            └───────────────▲─────────────────▲───────────┘
                            │                 │
         ┌──────────────────┘                 └───────────────────┐
   Solo (in-browser)                       Online (server-authoritative)
   useGame.ts                              Shared op layer (src/game):
     drives applyAction + presentation       handlers.ts (5 ops) · router.ts
     (deal animation, AI pauses, cover,       (dispatch/CORS/rate limit) ·
      sound) via LocalTransport               store.ts · config.ts · ids.ts
                            │                          │
                            │              ┌───────────┴────────────┐
                            │        GameStore adapter        GameStore adapter
                            │        supabaseStore.ts         tableStore.ts (api/)
                            │        (Postgres, Edge Fn)      (Table Storage, Azure Fn)
                            │                          │
                            │              NetworkTransport ◄─ change pings
                            │              useNetworkGame → redacted snapshots
                            └──────► React UI (src/components) ◄───┘
```

**The shared op layer is the key structural feature.** Both backends run the
*same* `handlers.ts` (the five ops), `router.ts` (op dispatch + CORS + per-IP
rate limiting), `store.ts` (the `GameStore` compare-and-set contract), plus
`config.ts`/`ids.ts`/`clientIp.ts` — on top of the rules engine. Each backend
supplies only a `GameStore` + rate-limiter **adapter** and a ~65-line entry shim
that marshals its native request into the router. Supabase bundles this layer
into `_shared/engine.mjs` (`npm run build:edge`); Azure imports it directly. So
the two servers can't drift — only their storage adapter differs.

### The pure core (`src/game`)

- **`engine.ts`** — card values, `scoreHand` (best single suit; 30½ trips),
  `takeDamage` (tokens, Grace, overflow), and the AI trait→behaviour mappings
  (`aiKnockTarget`, `aiBluffChance`, …). Player‑agnostic helpers.
- **`actions.ts`** — `applyAction(state, action)`: the single source of truth for
  state transitions (`deal`, `drawDeck`, `takeDiscard`, `discard`, `knock`,
  `nextDeal`). Pure and serializable — clones its input, no side effects. Also
  `createGameState`.
- **`authority.ts`** — the server brain on top of the reducer:
  - `applyPlayerAction(state, seatId, action)` — validates it's that seat's turn,
    rejects illegal actions (e.g. a player‑submitted `deal`), applies, settles.
  - `advanceAuthority(state)` — auto‑runs consecutive AI turns so a saved game
    always rests on a human's move (this is what makes **async** play work).
  - `redactState(state, viewerId)` — strips hidden information: a viewer sees
    only their own hand; opponents' hands and the deck are placeholders (counts
    preserved); all hands reveal at deal end. **Hidden info is enforced here.**

### Transport seam

`transport.ts` defines a small interface so the UI never mutates state directly —
it dispatches actions and renders published state.

- **`LocalTransport`** runs `applyAction` in‑process for solo play.
- **`NetworkTransport`** (`networkTransport.ts`) submits actions to the Edge
  Function and syncs the per‑seat redacted snapshot, using Supabase Realtime on a
  public lobby row as a "something changed, refetch" ping.

### Presentation

- **`useGame.ts`** — solo presentation layer over the reducer: the staggered deal
  animation, AI "thinking" pauses, pass‑the‑device cover, sound, and the knock
  beat — all layered on top of the authoritative state (it never bends the
  rules).
- **`useNetworkGame.ts`** — binds a `NetworkTransport` to React for online play
  (connect, snapshot, act/nextDeal/refresh, error).
- **`src/components`** — the board, lobby, setup, and overlays. The solo board is
  current‑player‑centric (hotseat); the online board is viewer‑centric (you're
  always at the bottom, controls gated to your turn).

## Hidden information

Locally, the pass‑the‑device cover screen prevents leaks between humans sharing a
device, and the deal-advance logic avoids flashing the next player's hand.
Online, the **server** redacts state per seat, so the network never carries
another player's cards — the UI literally cannot show what it never received.

## Multiplayer model (online)

Server‑authoritative and async. Authoritative state lives in the backend's
datastore — Postgres (`game_secrets`) on Supabase, Table Storage (a per-game
`secret` row) on Azure — and the server is the only writer. A player's secret
**seat token** authorizes their actions; only the current player can act; after a
human acts the server auto‑plays any AI turns and persists, so the game waits
patiently for the next human whenever they return. Every write is an atomic
compare-and-set gated by the game's version/ETag, so two racing writers can't
half-commit (a loser gets a 409 "retry"). The web client and the backend deploy
independently.

## Testing

`src/game/*.test.ts` (Vitest) cover the pure core: unit tests for scoring/damage/
AI, plus fuzz tests that play hundreds of random games asserting invariants
(52‑card conservation, clean elimination, monotonic tokens, termination, exactly
one winner — or a draw on simultaneous final elimination) and redaction
correctness. The shared op layer has its own contract tests against
`MemoryGameStore` with the real engine (`src/game/handlers.test.ts`,
`router.test.ts`), and each backend adapter is exercised directly — Supabase via
a fake client (`supabaseStore.test.ts`), Azure against Azurite in CI
(`api/src/game/tableStore.test.ts`). A real-browser Playwright suite runs the
solo path (`e2e/game.spec.ts`) and a **two-browser online round**
(`e2e/deployment.spec.ts`: create → join → start → act, proving per-seat
redaction) against a live deployment. See [TESTING.md](TESTING.md) for the full
layering.
