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
  property/fuzz test (`src/game/redactFuzz.test.ts`) asserts no seat (and no
  spectator) ever receives another player's cards or the deck.
- **Seat hijacking.** Each seat is bound to an unguessable per-seat **token**
  (UUID v4) issued on create/join and stored only in the secret record. Actions
  are authorized by token, not by client-supplied seat index.
- **Guessing game codes.** Join codes are 5 chars from a 32-symbol alphabet
  (no I/O/0/1) drawn from a CSPRNG (~33.5M combinations). Combined with the
  create-rate cap and the 14-day game TTL, the window for brute force is small.
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
  the secret table is service-role only (RLS denies anon access), and the
  `SECURITY DEFINER` RPCs (`commit_game`, `incr_if_below`) have `EXECUTE`
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
