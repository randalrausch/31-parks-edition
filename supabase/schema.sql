-- 31 · National Parks Edition — multiplayer schema
-- Run via `supabase db push` (migration) or paste into the SQL Editor.
--
-- Security model: the Edge Function is the only reader/writer of authoritative
-- state. Anon clients may ONLY read the public `games` row (lobby info + a
-- version counter used as a Realtime "something changed" ping). All card data
-- lives in `game_secrets`, which anon cannot touch at all. Per-player hidden
-- info is enforced by the Edge Function via redactState().

-- ── Public lobby + change-ping table (Realtime-enabled, no card data) ──
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'lobby',         -- lobby | playing | over
  version integer not null default 0,           -- bumped on every change
  seats jsonb not null default '[]'::jsonb,      -- [{idx,name,avatar,emoji,isAI,filled}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Authoritative full state + secret seat tokens (NO anon access) ──
create table if not exists public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  state jsonb not null,                          -- full GameState
  seat_tokens jsonb not null default '{}'::jsonb  -- { "<token>": <seatIndex> }
);

alter table public.games enable row level security;
alter table public.game_secrets enable row level security;

-- Anon may READ the public lobby row (for Realtime pings + lobby display).
-- Realtime requires row-level SELECT access, so this policy is permissive.
drop policy if exists "games are readable by anyone" on public.games;
create policy "games are readable by anyone"
  on public.games for select using (true);

-- PRIVACY: keep the row-level SELECT open (Realtime needs it) but hide the join
-- `code` column from anon REST enumeration via column-level privileges, so a
-- public-key client can't scrape open lobbies' invite codes. The client never
-- reads `code` from the table (it comes from the create/join Edge Function
-- responses); the Edge Function uses the service-role key, which bypasses these
-- grants. No card data is ever here (it lives in game_secrets, fully denied).
-- (Shipped as migration 20260701120000_restrict_lobby_code_select.sql.)
revoke select on public.games from anon, authenticated;
grant select (id, status, version, seats, created_at, updated_at)
  on public.games to anon, authenticated;

-- No anon write policies on games, and NO policies at all on game_secrets, so
-- anon is fully denied there. The Edge Function uses the service-role key,
-- which bypasses RLS.

-- Realtime: publish the public games table so clients get change pings.
alter publication supabase_realtime add table public.games;

-- Helpful index for joining by code.
create index if not exists games_code_idx on public.games (code);

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
