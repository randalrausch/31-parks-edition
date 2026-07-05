-- 31 · National Parks Edition — FORCE row-level security on every game table.
--
-- Companion to 20260704120000 (which revoked the default anon/authenticated table
-- grants). RLS normally does NOT apply to a table's OWNER; FORCE makes it apply to
-- the owner too, closing the last path by which a query run AS the table owner
-- could read/write these rows without going through a policy. Together with the
-- grant revoke, the secret tables are now defended by two independent barriers.
--
-- SAFETY — why this can't silently break the authority: the Edge Function uses the
-- service-role key, which has BYPASSRLS and is therefore unaffected by FORCE. The
-- three SECURITY DEFINER RPCs (create_game / commit_game / incr_if_below) run as
-- their OWNER; under FORCE RLS their INSERT/UPDATE would be denied UNLESS that
-- owner bypasses RLS. On Supabase the `postgres` role (which owns objects created
-- by migrations) has BYPASSRLS, so they keep working. Rather than ASSUME that,
-- assert it here and fail the migration LOUDLY if it doesn't hold: a stack where
-- the owner can't bypass RLS would otherwise break create/join/act at runtime,
-- invisibly (a local superuser-owned test can't reproduce it). Failing at
-- `db push` time — with RLS still unforced — is strictly safer than shipping a
-- backend that 500s on every write.
do $$
declare
  unsafe text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into unsafe
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('create_game', 'commit_game', 'incr_if_below')
    and not (r.rolbypassrls or r.rolsuper);
  if unsafe is not null then
    raise exception
      'Refusing to FORCE row-level security: the owner of % lacks BYPASSRLS/superuser, so its SECURITY DEFINER writes would be denied under FORCE RLS and break create/join/act. Grant BYPASSRLS to that owner (Supabase''s postgres role has it) and re-run.', unsafe;
  end if;
end $$;

alter table public.games         force row level security;
alter table public.game_codes    force row level security;
alter table public.game_secrets  force row level security;
alter table public.rate_counters force row level security;
