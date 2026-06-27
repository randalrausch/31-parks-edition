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

-- PRIVACY NOTE: because the SELECT above is open, an anon client with the
-- public key can enumerate open lobbies and their join `code`s. Codes are
-- unguessable CSPRNG values, so this only matters if you treat a code as a
-- private invite. No card data is ever here (it lives in game_secrets, which
-- anon cannot touch at all). OPTIONAL HARDENING — hide the code from REST
-- enumeration while keeping Realtime working (the client never reads `code`
-- from the table; it comes from the create/join Edge Function responses).
-- Apply, then verify online sync still works:
--   revoke select on public.games from anon, authenticated;
--   grant  select (id, status, version, seats, created_at, updated_at)
--     on public.games to anon, authenticated;

-- No anon write policies on games, and NO policies at all on game_secrets, so
-- anon is fully denied there. The Edge Function uses the service-role key,
-- which bypasses RLS.

-- Realtime: publish the public games table so clients get change pings.
alter publication supabase_realtime add table public.games;

-- Helpful index for joining by code.
create index if not exists games_code_idx on public.games (code);
