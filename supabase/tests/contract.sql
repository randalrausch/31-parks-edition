-- Real-Postgres contract for the multiplayer schema.
--
-- Run in CI against a live local stack (`supabase start`) via:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/contract.sql
--
-- Why psql and not the supabase-js store contract: Supabase CLI 2.71.1+ signs the
-- local stack's JWTs with ES256 (asymmetric), which the local PostgREST doesn't
-- verify for supabase-js — so neither the service_role JWT nor the new sb_secret
-- key authenticates as service_role locally (supabase/cli#4524, closed
-- not-planned). Asserting the SQL directly sidesteps the whole key/JWT layer and
-- tests exactly what a migration edit could break: the commit_game CAS, the
-- create_game atomicity/collision, the anon EXECUTE revokes, and the RLS that
-- hides game_secrets and the join code. The supabase-js adapter itself stays
-- covered by the fake-backed runStoreContract in src/game/supabaseStore.test.ts.
--
-- Each check RAISEs on failure; `-v ON_ERROR_STOP=1` turns any raise into a
-- non-zero psql exit, failing the job.

\echo '== seeding a game via create_game (as owner) =='
do $$
declare
  ok boolean;
begin
  ok := public.create_game(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'AAA111', 'lobby',
    '[{"idx":0,"name":"Host","filled":true}]'::jsonb,
    '{"deck":["x"],"turn":0}'::jsonb,
    '{"tok-host":0}'::jsonb);
  if not ok then
    raise exception 'create_game returned false on a fresh insert';
  end if;

  -- Atomicity: all three rows must exist (public row, code lookup, secret).
  if not exists (select 1 from public.games where id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'create_game did not insert the games row';
  end if;
  if not exists (select 1 from public.game_codes where code = 'AAA111') then
    raise exception 'create_game did not insert the game_codes row';
  end if;
  if not exists (select 1 from public.game_secrets where game_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'create_game did not insert the game_secrets row';
  end if;

  -- Collision: a second create with the SAME code must return false, and must
  -- not leave a half-created game behind (no orphan games row for the new id).
  ok := public.create_game(
    '22222222-2222-2222-2222-222222222222'::uuid,
    'AAA111', 'lobby', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb);
  if ok then
    raise exception 'create_game returned true on a duplicate code';
  end if;
  if exists (select 1 from public.games where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'create_game left an orphan games row after a collision';
  end if;
end $$;

\echo '== commit_game optimistic-concurrency CAS =='
do $$
declare
  v integer;
begin
  -- Correct expected version (0) → bumps to 1 AND writes the secret state.
  v := public.commit_game(
    '11111111-1111-1111-1111-111111111111'::uuid,
    0, 'playing', null, '{"deck":[],"turn":1}'::jsonb, null);
  if v <> 1 then
    raise exception 'commit_game with the current version returned %, expected 1', v;
  end if;
  if (select status from public.games where id = '11111111-1111-1111-1111-111111111111') <> 'playing' then
    raise exception 'commit_game did not update the public status';
  end if;
  if (select state->>'turn' from public.game_secrets where game_id = '11111111-1111-1111-1111-111111111111') <> '1' then
    raise exception 'commit_game did not write the secret state';
  end if;

  -- Stale expected version (0 again) → -1, and NOTHING changes (no half-commit).
  v := public.commit_game(
    '11111111-1111-1111-1111-111111111111'::uuid,
    0, 'over', null, '{"deck":[],"turn":99}'::jsonb, null);
  if v <> -1 then
    raise exception 'commit_game with a stale version returned %, expected -1', v;
  end if;
  if (select status from public.games where id = '11111111-1111-1111-1111-111111111111') <> 'playing' then
    raise exception 'a stale commit_game changed the public status (half-commit)';
  end if;
  if (select state->>'turn' from public.game_secrets where game_id = '11111111-1111-1111-1111-111111111111') <> '1' then
    raise exception 'a stale commit_game changed the secret state (half-commit)';
  end if;
end $$;

\echo '== incr_if_below atomic increment-iff-below-limit =='
do $$
declare
  ok boolean;
  c  integer;
begin
  -- Limit 2: the first two calls are allowed, the third is rejected — this is the
  -- durable per-window rate ceiling the create/join limiters lean on.
  ok := public.incr_if_below('rl-bucket', 'w1', 2);
  if not ok then raise exception 'incr_if_below call 1 should be allowed (count 0 < 2)'; end if;
  ok := public.incr_if_below('rl-bucket', 'w1', 2);
  if not ok then raise exception 'incr_if_below call 2 should be allowed (count 1 < 2)'; end if;
  ok := public.incr_if_below('rl-bucket', 'w1', 2);
  if ok then raise exception 'incr_if_below call 3 should be rejected (count 2 = limit)'; end if;

  -- The counter settled at exactly the limit — the rejected call did NOT increment.
  select count into c from public.rate_counters where bucket = 'rl-bucket' and window_key = 'w1';
  if c <> 2 then
    raise exception 'rate_counters settled at % , expected 2 (a rejected call must not increment)', c;
  end if;

  -- A different window is an independent bucket (windows don't bleed into each other).
  ok := public.incr_if_below('rl-bucket', 'w2', 2);
  if not ok then raise exception 'incr_if_below for a fresh window should be allowed'; end if;
end $$;

\echo '== EXECUTE on the SECURITY DEFINER RPCs is revoked from anon/authenticated =='
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.create_game(uuid,text,text,jsonb,jsonb,jsonb)', 'execute') then
      raise exception '% can EXECUTE create_game (must be revoked)', r;
    end if;
    if has_function_privilege(r, 'public.commit_game(uuid,integer,text,jsonb,jsonb,jsonb)', 'execute') then
      raise exception '% can EXECUTE commit_game (must be revoked)', r;
    end if;
    if has_function_privilege(r, 'public.incr_if_below(text,text,integer)', 'execute') then
      raise exception '% can EXECUTE incr_if_below (must be revoked)', r;
    end if;
  end loop;
end $$;

\echo '== RLS: anon cannot read game_secrets or the join code, but CAN read the lobby row =='
do $$
declare
  n integer;
begin
  -- Positive control (as owner): the secret row we seeded really exists, so the
  -- anon "0 rows" below means RLS hid it — not that the table is empty.
  if (select count(*) from public.game_secrets where game_id = '11111111-1111-1111-1111-111111111111') <> 1 then
    raise exception 'setup: expected the seeded game_secrets row to exist';
  end if;

  set local role anon;

  -- game_secrets: no anon policy (and/or no grant) → zero rows or a hard denial.
  -- Either way anon must not SEE the card data.
  begin
    select count(*) into n from public.game_secrets;
    if n <> 0 then
      raise exception 'anon read % game_secrets rows (RLS must hide all card data)', n;
    end if;
  exception when insufficient_privilege then
    null; -- fully denied is also acceptable
  end;

  -- game_codes: the join code lookup is anon-denied the same way.
  begin
    select count(*) into n from public.game_codes;
    if n <> 0 then
      raise exception 'anon read % game_codes rows (the join code must be hidden)', n;
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- games: anon CAN read the public lobby row (Realtime needs SELECT). This is the
  -- positive control that proves the two denials above aren't vacuous.
  select count(*) into n from public.games where id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 then
    raise exception 'anon could not read the public games lobby row (got % rows)', n;
  end if;

  reset role;
end $$;

\echo '== grants: anon/authenticated hold NO privilege on the secret tables, and cannot write games =='
do $$
declare
  r text;
  m text;
begin
  -- Defense-in-depth (20260704120000): the secret tables must stay unreachable by
  -- anon/authenticated even if RLS were ever disabled — so they must hold NO table
  -- privilege at all. This asserts the GRANT state directly, independent of the
  -- RLS checks above (an RLS-only guard would still pass if the grant leaked back).
  foreach r in array array['anon', 'authenticated'] loop
    foreach m in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(r, 'public.game_secrets', m) then
        raise exception '% still has % on game_secrets (grant must be revoked)', r, m;
      end if;
      if has_table_privilege(r, 'public.game_codes', m) then
        raise exception '% still has % on game_codes (grant must be revoked)', r, m;
      end if;
      if has_table_privilege(r, 'public.rate_counters', m) then
        raise exception '% still has % on rate_counters (grant must be revoked)', r, m;
      end if;
    end loop;

    -- games: writes must be revoked. SELECT stays (Realtime + lobby need it; the
    -- RLS block above proves anon can still read the public lobby row).
    foreach m in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(r, 'public.games', m) then
        raise exception '% can still % public.games (write grant must be revoked)', r, m;
      end if;
    end loop;
  end loop;
end $$;

\echo '== OK: real-Postgres contract passed =='
