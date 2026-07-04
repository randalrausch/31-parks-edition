# ADR 0001 — One rules engine, two front ends, two back ends

- Status: Accepted
- Date: 2026-07

## Context

31 has four places the game "runs": a solo/pass-and-play board, an online board,
and two server authorities (Supabase Edge Function, Azure Functions). A naïve
build would reimplement scoring, tokens/grace, the knock penalty, and turn flow
in each place — and they would silently drift, so a rule fix in one surface
wouldn't reach the others, and the server could disagree with the client about a
game it's supposed to referee.

## Decision

The rules live in exactly one place — `src/game/` (`engine.ts`, `actions.ts`,
`authority.ts`) — as pure, serializable, framework-free TypeScript. Everything
else consumes them:

- The two boards (`GameBoard.tsx`, `OnlineGameBoard.tsx`) render the same shared
  leaf components from `BoardParts.tsx`; an ESLint `no-restricted-imports` rule
  forbids them importing each other, forcing shared UI into `BoardParts`.
- Both backends run the same op layer (`handlers.ts`, `router.ts`, `config.ts`)
  over the same engine; each supplies only a `GameStore` + rate-limiter adapter.

## Consequences

- A rules change lands once and reaches all four surfaces; the server enforces
  the exact rules the client plays, which is what makes online play
  tamper-resistant (the client can't forge an outcome the server won't accept).
- The purity constraint is a real cost: `engine.ts`/`actions.ts`/`authority.ts`
  must stay free of React, DOM, timers, sound, and network. Presentation lives in
  `useGame.ts` and the components.
- "Parity" becomes the signature maintenance hazard — a feature can land in one
  board or one adapter and not its sibling. It's defended with tooling (the lint
  rule, the shared store contract, the edge-bundle CI gate) rather than vigilance.
