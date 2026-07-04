# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"**
(Security → Advisories) on this repository, rather than opening a public issue.
We'll acknowledge within a few days. This is a hobby project, so please be patient.

## Threat model

31: National Parks Edition is a turn-based card game. The online backend is
**server-authoritative** and the same pure rules run on client and server. The
threats we design against, and how:

- **Cheating / seeing hidden cards.** All authoritative state lives server-side;
  the wire only ever carries a per-seat *redacted* view (`redactState`). A
  property/fuzz test (`src/game/redactFuzz.test.ts`) asserts no seat ever receives
  another player's cards or the deck. The end-of-deal showdown is revealed only to
  **seated** players; a tokenless caller (no valid seat token) never sees another
  player's hand even at reveal, so a game isn't exposed just because its id is
  guessable.
- **Seat hijacking.** Each seat is bound to an unguessable per-seat **token**
  (UUID v4) issued on create/join and stored only in the secret record. Actions
  are authorized by token, not by client-supplied seat index.
- **Guessing / harvesting game codes.** Join codes are 6 chars from a 32-symbol
  alphabet (no I/O/0/1) drawn from a CSPRNG (~1.07B combinations). Combined with
  a dedicated **per-IP join-attempt cap** and the 14-day game TTL, the window for
  brute force is small. Codes are allocated collision-safely on both backends (a
  duplicate is regenerated, never allowed to clobber a live lobby). On Supabase,
  codes live in a **separate, unpublished `game_codes` table** — never in the
  Realtime-published `games` row — because Realtime broadcasts whole rows and
  ignores column-level grants, so an anon client can't harvest open lobbies'
  codes off the change feed.
- **Floods / abuse / cost-runaway.** Anonymous endpoints are defended in layers so
  no attack, bug, or spike can drive up a cloud bill: a cheap per-instance limiter
  (a per-IP request rate, plus a **per-seat cap on `act`** so a single seat token —
  which, unlike an IP, can't be rotated — can't hammer the one op that writes state
  and broadcasts), plus **durable Table-Storage-backed caps shared across all
  instances** — a per-IP/hour create cap and a **global games-per-day ceiling**
  (both configurable). On Azure the **Function scale-out is capped**
  (`maxFunctionInstances`) so it can't
  fan out to hundreds of instances, telemetry ingestion has a **daily cap**, and a
  **monthly Budget alert** is available. Abandoned games expire after 14 days and
  are reaped, bounding storage growth. See `docs/AZURE.md → Cost protection`.
- **Backend data access.** On Azure, game data in Table Storage is reached via the
  Function App's **managed identity** (no data connection string). On Supabase,
  the secret and code tables are service-role only (RLS denies anon access), and
  the `SECURITY DEFINER` RPCs (`create_game`, `commit_game`, `incr_if_below`)
  have `EXECUTE`
  **revoked from anon/authenticated** so they can't be called over PostgREST to
  bypass the Edge Function — a CI test (`supabase/schema.grants.test.ts`) enforces
  that every definer RPC is revoked. The browser only ever holds client-safe
  values (publishable/anon key, or the public API URL).

### Explicit non-goals

No accounts/identity, no anti-collusion between human players who share hands out
of band, no DDoS protection beyond the lightweight limiter, and no protection of a
self-hosted instance's own cloud credentials. These are out of scope for a family
/ community-scale game; see `docs/AZURE.md` for hardening if you run it publicly.

## Supported versions

The latest `main` is supported. There are no long-term support branches.
