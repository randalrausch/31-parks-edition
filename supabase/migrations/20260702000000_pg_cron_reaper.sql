-- 31 · National Parks Edition — deterministic reaping via pg_cron
--
-- Replaces the opportunistic sweep (a ~2%-of-requests DELETE fired from the Edge
-- Function) with a scheduled job, so abandoned games are reaped on a fixed
-- cadence regardless of traffic. The opportunistic sweep couldn't run once
-- creates stopped — which is exactly the "abandoned" scenario — and taxed the
-- hot path; a cron job has neither problem. It also reaps stale rate-limit
-- counters so that table can't grow without bound.
--
-- NOTE (verify after `supabase db push`): pg_cron must be available on the
-- project. `create extension` enables it on Supabase; if your plan/region needs
-- it toggled in the dashboard first (Database → Extensions → pg_cron), do that,
-- then re-run. Confirm the job with:  select * from cron.job;

create extension if not exists pg_cron;

-- rate_counters had no timestamp to age rows by; add one. Existing rows adopt
-- now(); incr_if_below's ON CONFLICT never touches it, so it marks each window's
-- first-seen time — which is what the reaper ages against.
alter table public.rate_counters
  add column if not exists created_at timestamptz not null default now();

-- (Re)define the daily reaper idempotently, so re-applying this migration is safe.
do $$
begin
  perform cron.unschedule('reap-31-parks');
exception
  when others then null; -- no such job yet
end $$;

select cron.schedule(
  'reap-31-parks',
  '17 3 * * *', -- 03:17 UTC daily (off the top of the hour to spread load)
  $$
    delete from public.games where updated_at < now() - interval '14 days';
    delete from public.rate_counters where created_at < now() - interval '2 days';
  $$
);
