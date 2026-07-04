# ADR 0002 — Two interchangeable storage backends behind one op layer

- Status: Accepted
- Date: 2026-07

## Context

Online play needs an authoritative server with durable storage and atomic
optimistic-concurrency commits. Two hosting stories are worth supporting: an
all-in-one Supabase project (Edge Function + Postgres) and an Azure Functions +
Table Storage stack that scales to zero. The risk is that "two backends" turns
into two copies of the ops, the router, redaction, and rate limiting — the
largest possible drift surface.

## Decision

Only the **storage/rate-limiter adapter** differs per backend. The op layer is
shared: the five ops (`handlers.ts`), the router + CORS + per-instance limiter
(`router.ts`), the durable rate bucketing (`rateLimit.ts`), the create sanitizer
(`config.ts`), and the `GameStore` interface (`store.ts`) all live in `src/game/`
and run on both. Each backend supplies a `GameStore` implementation
(`supabaseStore.ts` / `api/src/game/tableStore.ts`) and a thin request shim.

Both adapters are held to one behavioral contract (`storeContract.ts`): atomic
create, code-collision handling, optimistic-concurrency CAS, redaction-safe
reads. It runs against the memory store, real Azurite in CI, and the Supabase
fake — so "the backends behave identically" is a failing test, not a claim.

## Consequences

- Logic duplication is near zero; a backend change usually lands once in
  `src/game/`. What still differs (and must be kept in parity by hand) is the two
  adapters and their entry shims.
- The operational surface is genuinely doubled: two deploy pipelines, two infra
  stacks, two smoke paths. This is the project's largest ongoing cost and is
  accepted deliberately — the swappable-backend seam is part of what the repo
  demonstrates. A fork that only wants one backend can delete the other adapter
  and its workflow without touching `src/game/`.
- Storage-specific concerns stay isolated: Table Storage code lives only in
  `api/`; Postgres/RLS/RPC concerns live only in `supabase/`.
