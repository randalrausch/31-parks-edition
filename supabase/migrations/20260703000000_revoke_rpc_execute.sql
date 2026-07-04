-- 31 · National Parks Edition — lock down the SECURITY DEFINER RPCs
--
-- commit_game() and incr_if_below() are SECURITY DEFINER functions in the
-- PostgREST-exposed `public` schema. Postgres grants EXECUTE to PUBLIC on a new
-- function BY DEFAULT, and PostgREST surfaces public-schema functions at
-- /rest/v1/rpc/<name>. Together that means an anonymous client holding only the
-- public anon key could call them directly and bypass the entire Edge Function
-- authority:
--
--   * commit_game(...) writes game_secrets.state and seat_tokens under the
--     owner's rights — a caller could forge any hand, force a deal outcome, zero
--     out opponents' tokens, or inject their own seat token to seize a seat.
--   * incr_if_below(...) mutates the durable rate counters — a caller could drive
--     the global/day counter to its cap and deny `create` to everyone.
--
-- These functions are meant to be invoked ONLY by the service-role Edge Function,
-- whose role bypasses grants (it is the table owner / a superuser-equivalent).
-- Revoke the default EXECUTE grant from every client-reachable role.
--
-- Idempotent: REVOKE on an already-revoked grant is a no-op.

revoke execute on function public.commit_game(uuid, integer, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

revoke execute on function public.incr_if_below(text, text, integer)
  from public, anon, authenticated;
