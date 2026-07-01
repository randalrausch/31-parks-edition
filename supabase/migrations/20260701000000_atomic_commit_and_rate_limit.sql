-- 31 · National Parks Edition — atomic commit + durable rate limiting
--
-- Two additions that bring the Supabase authority to parity with the Azure one:
--
--   1. commit_game(...)  — a single-transaction optimistic-concurrency commit
--      that bumps games.version (iff unchanged) AND writes the secret state in
--      ONE transaction. Replaces the old two-statement casBump()+saveSecret()
--      sequence, which could leave games bumped while game_secrets stayed stale
--      if the second write failed (a torn write).
--
--   2. rate_counters + incr_if_below(...) — a durable, cross-instance counter
--      so the costly `create` op is bounded globally (per-day) and per-IP
--      (per-hour), not just by the ephemeral per-instance limiter. Mirrors the
--      Azure Table Storage rate limiter.
--
-- Both are called by the Edge Function with the service-role key, which bypasses
-- RLS. Anon has no access to either the RPCs' effects or the counter table.

-- ── 1. Atomic optimistic-concurrency commit ──────────────────────────────────

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
  -- Claim the version: only succeeds if nobody else moved first.
  update public.games
     set version    = p_expected_version + 1,
         updated_at = now(),
         status     = coalesce(p_status, status),
         seats      = coalesce(p_seats, seats)
   where id = p_id
     and version = p_expected_version
   returning version into v_new;

  if v_new is null then
    return -1;  -- version conflict — caller reports a retryable 409
  end if;

  -- Same transaction: write the secret state/tokens so the two rows can never
  -- half-commit. null patch fields keep their existing column value.
  update public.game_secrets
     set state       = coalesce(p_state, state),
         seat_tokens = coalesce(p_seat_tokens, seat_tokens)
   where game_id = p_id;

  return v_new;
end;
$$;

-- ── 2. Durable, cross-instance rate-limit counter ────────────────────────────

create table if not exists public.rate_counters (
  bucket     text    not null,
  window_key text    not null,
  count      integer not null default 0,
  primary key (bucket, window_key)
);

alter table public.rate_counters enable row level security;
-- No policies: anon is fully denied. Only the service-role Edge Function (which
-- bypasses RLS) touches this table, via the RPC below.

-- Atomically increment (bucket, window_key) IFF still below `p_limit`. Returns
-- true when the request is within the cap (and was counted), false when at/over.
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

  -- On a conflict where the WHERE guard fails (already at the cap), no row is
  -- returned and v_count stays null → over the limit.
  return v_count is not null;
end;
$$;

-- Optional housekeeping: a stale-counter reaper could be added via pg_cron, but
-- keys are date/hour-scoped and tiny, so unbounded growth is negligible.
