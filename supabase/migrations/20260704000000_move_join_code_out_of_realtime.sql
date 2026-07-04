-- Move the join `code` OUT of the Realtime-published `games` table.
--
-- Supabase Realtime's postgres_changes broadcasts the whole changed row and does
-- NOT honor column-level GRANTs — so the earlier column-revoke
-- (20260701120000_restrict_lobby_code_select.sql) hid `code` from REST but NOT
-- from Realtime. Any anon client with the public key could open its own
-- unfiltered channel on `public.games` and harvest every lobby's invite code as
-- it was created, then squat/grief seats. (Cards were never exposed — those live
-- in game_secrets, which is unpublished and anon-denied.)
--
-- Fix: keep codes in a separate, UNPUBLISHED, anon-denied lookup table — the same
-- shape the Azure backend already uses (a GameCodes table). A column that isn't in
-- the published table can't be broadcast, regardless of the Realtime version.

-- ── Code → game lookup (never published, service-role only) ──
create table if not exists public.game_codes (
  code    text primary key,                                       -- uppercase join code
  game_id uuid not null references public.games(id) on delete cascade
);
alter table public.game_codes enable row level security;
-- No policies: anon fully denied. The Edge Function (service-role) bypasses RLS,
-- and this table is deliberately NOT added to the supabase_realtime publication.

-- Backfill existing codes, then drop the column + its index from the public row.
insert into public.game_codes (code, game_id)
  select code, id from public.games
  on conflict (code) do nothing;

drop index if exists games_code_idx;
alter table public.games drop column if exists code;

-- ── Recreate the atomic create to claim the code in game_codes ──
-- Same signature; the code now lands in game_codes (its primary key gives the
-- same collision detection) inside the one create transaction. `create or
-- replace` preserves the EXECUTE revoke, but re-assert it defensively.
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
