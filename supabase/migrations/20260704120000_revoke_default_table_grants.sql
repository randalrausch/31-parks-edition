-- 31 · National Parks Edition — defense-in-depth: strip the default anon/
-- authenticated table grants so RLS is not the SINGLE barrier between the public
-- anon key and every hidden hand + seat token.
--
-- Supabase's platform bootstrap grants broad table privileges to the `anon` and
-- `authenticated` roles on new tables in the `public` schema (via ALTER DEFAULT
-- PRIVILEGES). There is in-repo proof this happens here: migration
-- 20260701120000_restrict_lobby_code_select.sql had to `revoke select on
-- public.games from anon` — a revoke that only makes sense because anon RECEIVED
-- that grant by default (the schema never explicitly granted it). By the same
-- mechanism game_secrets / game_codes / rate_counters almost certainly carry
-- default anon grants too.
--
-- Today those secret tables are protected ONLY by "RLS enabled + no policy"
-- (default-deny). That single barrier is correct, but its blast radius is
-- catastrophic: if RLS is ever turned off — a dashboard toggle, a migration typo,
-- a `create table as` that forgets to re-enable it — the leftover grant would
-- instantly expose the raw state (all hands) and every seat token to any
-- anon-key holder, bypassing the Edge Function's per-seat redaction entirely.
-- Revoking the underlying grant adds an INDEPENDENT second barrier: with no table
-- privilege, anon is denied even with RLS off.
--
-- Safe to apply: the Edge Function uses the service-role key (BYPASSRLS + its own
-- grants) and the SECURITY DEFINER RPCs run as their owner, so neither depends on
-- the anon/authenticated grants removed here. `games` keeps the column-scoped
-- SELECT that Realtime + lobby display need (granted in 20260701120000) — only
-- its write privileges are revoked. Idempotent: REVOKE of an absent grant is a
-- no-op.

-- Secret tables: no client-reachable role gets ANY access. Revoke from `public`
-- too (matching the RPC-revoke idiom in 20260703000000) so a latent default grant
-- to the PUBLIC pseudo-role can't leave a back door open.
revoke all on public.game_secrets  from public, anon, authenticated;
revoke all on public.game_codes    from public, anon, authenticated;
revoke all on public.rate_counters from public, anon, authenticated;

-- Public lobby row: anon keeps SELECT (Realtime change-pings + lobby display) but
-- no role may write it — the Edge Function (service-role) performs every mutation.
revoke insert, update, delete on public.games from public, anon, authenticated;
