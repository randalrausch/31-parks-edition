/**
 * 31 · National Parks Edition — game Edge Function (the authority).
 *
 * Thin Deno adapter: it marshals the incoming Request into the shared, tested
 * router (op dispatch + CORS + rate limiting) that ALSO powers the Azure backend,
 * backed by a Supabase GameStore. All authority logic — the five ops, hidden-info
 * redaction, atomic commits — lives in src/game/ and is bundled into
 * ../_shared/engine.mjs, so the two backends can never drift.
 *
 * Ops (POST JSON { op, ... }):
 *   create { config }                     → { gameId, code, seatIndex, seatToken }
 *   join   { code, name }                 → { gameId, seatIndex, seatToken }
 *   start  { gameId, seatToken }          → { ok }
 *   act    { gameId, seatToken, action }  → { ok }
 *   state  { gameId, seatToken? }         → { status, version, seats, seatIndex, state }
 */
// @ts-expect-error — Deno std import resolved at deploy time
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  makeRouter,
  makeSupabaseStore,
  makeSupabaseRateLimiter,
  clientIp,
} from "../_shared/engine.mjs";

// @ts-expect-error — Deno global
const env = (k: string) => Deno.env.get(k);
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

// Durable create caps (per-IP/hour + global/day), configurable via env. The
// shared router applies its own cheap per-instance first line on top.
const MAX_GAMES_PER_DAY = Number(env("MAX_GAMES_PER_DAY")) || 500;
const MAX_GAMES_PER_IP_PER_HOUR = Number(env("MAX_GAMES_PER_IP_PER_HOUR")) || 20;

const store = makeSupabaseStore(admin);
const route = makeRouter(store, {
  // ALLOWED_ORIGIN is read here (Deno) and passed in; the router never touches env.
  allowedOrigin: env("ALLOWED_ORIGIN") ?? "*",
  provider: "Supabase",
  // supabase-js sends apikey/authorization/x-client-info, so the CORS preflight
  // must allow them (the Azure fetch client only needs content-type).
  allowedHeaders: "authorization, x-client-info, apikey, content-type",
  rateLimiter: makeSupabaseRateLimiter(admin, MAX_GAMES_PER_DAY, MAX_GAMES_PER_IP_PER_HOUR),
  // Supabase captures function stdout in its logs, so this structured line is a
  // queryable request/error/latency trail (Dashboard → Edge Functions → Logs).
  onEvent: (event, data) => console.log(JSON.stringify({ event, ...data })),
});

// The Supabase/Cloudflare edge sets cf-connecting-ip to the true client and
// overwrites any client-supplied value, so trust it first; otherwise fall back
// to the right-most (infra-appended) X-Forwarded-For hop. Never the left-most,
// which the client controls and could rotate to dodge the rate limits.
// @ts-expect-error — Deno global
Deno.serve(async (req: Request): Promise<Response> => {
  // Abandoned games + stale rate counters are reaped by a pg_cron job (see
  // supabase/migrations/20260702000000_pg_cron_reaper.sql) rather than
  // opportunistically here, so the hot path stays clean and reaping happens on a
  // fixed cadence even when traffic stops.
  const res = await route({
    method: req.method,
    ip: clientIp(req.headers, ["cf-connecting-ip", "x-real-ip"]),
    origin: req.headers.get("origin") ?? undefined,
    readJson: () => req.json(),
  });
  return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
    status: res.status,
    headers: res.headers,
  });
});
