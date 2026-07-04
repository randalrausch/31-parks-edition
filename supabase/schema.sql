-- 31 · National Parks Edition — multiplayer schema
-- Run via `supabase db push` (migration) or paste into the SQL Editor.
--
-- Security model: the Edge Function is the only reader/writer of authoritative
-- state. Anon clients may ONLY read the public `games` row (lobby info + a
-- version counter used as a Realtime "something changed" ping). All card data
-- lives in `game_secrets`, which anon cannot touch at all. Per-player hidden
-- info is enforced by the Edge Function via redactState().

-- ── Public lobby + change-ping table (Realtime-enabled, no card data) ──
-- NB: the join `code` is deliberately NOT a column here. Realtime broadcasts the
-- whole changed row and ignores column-level GRANTs, so any anon-readable column
-- on a published table is effectively public. Codes live in game_codes (below),
-- which is unpublished and anon-denied. (See migration
-- 20260704000000_move_join_code_out_of_realtime.sql.)
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'lobby',         -- lobby | playing | over
  version integer not null default 0,           -- bumped on every change
  seats jsonb not null default '[]'::jsonb,      -- [{idx,name,avatar,emoji,isAI,filled}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Join code → game lookup (NOT published to Realtime, NO anon access) ──
-- Separate from `games` precisely so an invite code is never in a Realtime row
-- payload. The primary key on `code` also gives create-time collision detection.
create table if not exists public.game_codes (
  code    text primary key,
  game_id uuid not null references public.games(id) on delete cascade
);

-- ── Authoritative full state + secret seat tokens (NO anon access) ──
create table if not exists public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  state jsonb not null,                          -- full GameState
  seat_tokens jsonb not null default '{}'::jsonb  -- { "<token>": <seatIndex> }
);

alter table public.games enable row level security;
alter table public.game_codes enable row level security;
alter table public.game_secrets enable row level security;

-- Anon may READ the public lobby row (for Realtime pings + lobby display).
-- Realtime requires row-level SELECT access, so this policy is permissive.
drop policy if exists "games are readable by anyone" on public.games;
create policy "games are readable by anyone"
  on public.games for select using (true);

-- The published `games` row carries only non-sensitive lobby fields, so the
-- permissive row-level SELECT above is safe for Realtime. (There is no join
-- `code` column to hide anymore — it moved to game_codes.)

-- No anon policies on game_codes or game_secrets, so anon is fully denied on
-- both. The Edge Function uses the service-role key, which bypasses RLS. Neither
-- table is added to the Realtime publication, so their rows are never broadcast.

-- Realtime: publish ONLY the public games table so clients get change pings.
alter publication supabase_realtime add table public.games;

-- ── Atomic create ──
-- Inserts the public row AND the secret row in ONE transaction so a game can
-- never half-exist (an orphan `games` row squatting a join code). Returns true
-- on success, false if the code (or id) is already taken so the caller can
-- regenerate the code and retry. Service-role only (see the revoke below).
create or replace function public.create_game(
  p_id uuid,
  p_code text,
  p_status text,
  p_seats jsonb,
  p_state jsonb,
  p_seat_tokens jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.games (id, status, version, seats)
    values (p_id, p_status, 0, p_seats);
  insert into public.game_codes (code, game_id)
    values (p_code, p_id);
  insert into public.game_secrets (game_id, state, seat_tokens)
    values (p_id, p_state, p_seat_tokens);
  return true;
exception
  when unique_violation then
    return false;  -- code/id already exists — caller retries with a new code
end;
$$;

revoke execute on function public.create_game(uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

-- ── Atomic optimistic-concurrency commit ──
-- Bumps games.version (iff unchanged) AND writes the secret state in ONE
-- transaction, so the public row and the secret row can never half-commit.
-- Returns the new version, or -1 on a version conflict (caller retries).
create or replace function public.commit_game(
  p_id uuid,
  p_expected_version integer,
  p_status text default null,
  p_seats jsonb default null,
  p_state jsonb default null,
  p_seat_tokens jsonb default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
begin
  update public.games
     set version    = p_expected_version + 1,
         updated_at = now(),
         status     = coalesce(p_status, status),
         seats      = coalesce(p_seats, seats)
   where id = p_id
     and version = p_expected_version
   returning version into v_new;
  if v_new is null then
    return -1;
  end if;
  update public.game_secrets
     set state       = coalesce(p_state, state),
         seat_tokens = coalesce(p_seat_tokens, seat_tokens)
   where game_id = p_id;
  return v_new;
end;
$$;

-- SECURITY: this is a SECURITY DEFINER function in the PostgREST-exposed `public`
-- schema, so Postgres' default EXECUTE-to-PUBLIC grant would let any anon caller
-- invoke it over /rest/v1/rpc and forge authoritative state. It must ONLY be
-- callable by the service-role Edge Function (which bypasses grants). Revoke the
-- default grant. (See migration 20260703000000_revoke_rpc_execute.sql.)
revoke execute on function public.commit_game(uuid, integer, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

-- ── Durable, cross-instance rate-limit counter (for the `create` op) ──
create table if not exists public.rate_counters (
  bucket     text        not null,
  window_key text        not null,
  count      integer     not null default 0,
  created_at timestamptz not null default now(), -- first-seen; the reaper ages by this
  primary key (bucket, window_key)
);
alter table public.rate_counters enable row level security;
-- No policies: anon fully denied; only the service-role Edge Function touches it.

-- Atomically increment (bucket, window_key) IFF still below p_limit.
create or replace function public.incr_if_below(
  p_bucket text,
  p_window text,
  p_limit  integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_counters (bucket, window_key, count)
  values (p_bucket, p_window, 1)
  on conflict (bucket, window_key)
    do update set count = public.rate_counters.count + 1
      where public.rate_counters.count < p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;

-- SECURITY: service-role only (see the note on commit_game above). Without this,
-- an anon caller could poison the durable rate counters to deny `create` globally.
revoke execute on function public.incr_if_below(text, text, integer)
  from public, anon, authenticated;

-- ── Deterministic reaping (pg_cron) ──
-- A daily job reaps abandoned games (14 days idle; cascades to game_secrets) and
-- stale rate counters, so the DB stays bounded on a fixed cadence regardless of
-- traffic. This replaces an opportunistic sweep the Edge Function used to run.
-- (pg_cron may need enabling in Database → Extensions; verify with
--  `select * from cron.job;`.)
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('reap-31-parks');
exception
  when others then null;
end $$;
select cron.schedule('reap-31-parks', '17 3 * * *', $$
  delete from public.games where updated_at < now() - interval '14 days';
  delete from public.rate_counters where created_at < now() - interval '2 days';
$$);

-- ── Defense-in-depth: strip default anon/authenticated table grants ──
-- Supabase grants broad privileges to anon/authenticated on new public tables by
-- default (the reason 20260701120000 had to revoke SELECT on games). The secret
-- tables are guarded by "RLS enabled + no policy", but that's a SINGLE barrier;
-- revoke the underlying grant too so anon stays denied even if RLS is ever turned
-- off. The Edge Function (service-role) and the SECURITY DEFINER RPCs don't depend
-- on these grants. `games` keeps its column-scoped anon SELECT (Realtime + lobby)
-- and loses only writes. (See migration 20260704120000_revoke_default_table_grants.sql.)
revoke all on public.game_secrets  from public, anon, authenticated;
revoke all on public.game_codes    from public, anon, authenticated;
revoke all on public.rate_counters from public, anon, authenticated;
revoke insert, update, delete on public.games from public, anon, authenticated;
