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
import { makeRouter, makeSupabaseStore, makeSupabaseRateLimiter } from "../_shared/engine.mjs";

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
});

const clientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("cf-connecting-ip") ||
  "unknown";

// @ts-expect-error — Deno global
Deno.serve(async (req: Request): Promise<Response> => {
  // Opportunistically reap abandoned games on a small fraction of requests so the
  // DB stays bounded without a cron (fire-and-forget; failures ignored). A
  // pg_cron reaper is the cleaner long-term fix.
  if (Math.random() < 0.02) void store.deleteExpired(new Date().toISOString()).catch(() => {});

  const res = await route({
    method: req.method,
    ip: clientIp(req),
    origin: req.headers.get("origin") ?? undefined,
    readJson: () => req.json(),
  });
  return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
    status: res.status,
    headers: res.headers,
  });
});
