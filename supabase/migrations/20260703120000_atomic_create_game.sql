-- 31 · National Parks Edition — atomic create_game()
--
-- createGame() used to be two independent inserts (games, then game_secrets).
-- If the second failed, an orphan `games` row squatted the join code for 14
-- days and any join on it 404'd confusingly. This RPC writes both rows in ONE
-- transaction, mirroring commit_game(), so a game can never half-exist. It
-- returns false on a unique_violation (code/id already taken) so the caller can
-- regenerate the code and retry rather than clobbering a live lobby.
--
-- SECURITY DEFINER + service-role only: EXECUTE is revoked from anon (an anon
-- caller could otherwise insert arbitrary authoritative state — see
-- 20260703000000_revoke_rpc_execute.sql for the same reasoning).

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
  insert into public.games (id, code, status, version, seats)
    values (p_id, p_code, p_status, 0, p_seats);
  insert into public.game_secrets (game_id, state, seat_tokens)
    values (p_id, p_state, p_seat_tokens);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke execute on function public.create_game(uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
