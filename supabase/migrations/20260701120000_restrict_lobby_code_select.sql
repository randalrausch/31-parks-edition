-- 31 · National Parks Edition — hide the lobby join `code` from anon REST reads
--
-- The "games are readable by anyone" SELECT policy (needed for Realtime change
-- pings + lobby display) let any anon client with the publishable key enumerate
-- open lobbies AND their join `code`s via PostgREST — turning codes, which are
-- meant to act as private invites, into public data. No card data was ever
-- exposed here (that lives in game_secrets, which anon cannot touch at all).
--
-- Fix: keep row-level SELECT open (Realtime needs it) but drop `code` from the
-- columns anon/authenticated may read, via column-level privileges. The client
-- never reads `code` from the `games` table — it only ever comes back from the
-- create/join Edge Function responses — so online sync keeps working. The Edge
-- Function uses the service-role key, which bypasses these grants entirely.
--
-- NOTE: Supabase Realtime's postgres_changes respects column privileges, so
-- after deploying this, verify online sync still delivers change pings (the
-- `code` column is simply omitted from the payload, which the client doesn't
-- use). If pings stop, the client still converges via its safety-net poll.

revoke select on public.games from anon, authenticated;
grant select (id, status, version, seats, created_at, updated_at)
  on public.games to anon, authenticated;
