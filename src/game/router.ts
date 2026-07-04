/**
 * Framework-free request router: op dispatch, CORS, and a best-effort per-instance
 * rate limiter — independent of any host runtime so it's unit-testable and runs
 * on BOTH backends. Each backend's entry adapter (Azure `api/src/index.ts`, the
 * Supabase Edge Function) marshals its native request into a RawRequest and calls
 * this. Env-derived config (origin, provider) is passed in via opts, never read
 * here, so the same code runs unchanged in Node and Deno.
 */
import {
  handleAct,
  handleClientError,
  handleCreate,
  handleHealth,
  handleJoin,
  handleStart,
  handleState,
  handleVersion,
  type OpResult,
} from "./handlers";
import { StateTooLargeError, type GameStore } from "./store";
import type { RateLimiter } from "./rateLimit";
import { PROTOCOL_VERSION } from "./version";

export interface RawRequest {
  method: string;
  ip: string;
  origin?: string;
  readJson: () => Promise<unknown>;
}
export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

const OPS: Record<string, (s: GameStore, body: any) => Promise<OpResult>> = {
  create: handleCreate,
  join: handleJoin,
  start: handleStart,
  act: handleAct,
  state: handleState,
};

export function makeRouter(
  store: GameStore,
  opts: {
    allowedOrigin?: string;
    rateLimiter?: RateLimiter;
    /** Reported by the `version` op (About dialog). "Azure" | "Supabase". */
    provider?: string;
    /** CORS Access-Control-Allow-Headers. supabase-js needs the fuller set. */
    allowedHeaders?: string;
    /**
     * Structured observability sink. Called once per request with the op, HTTP
     * status, and latency (ms). Each backend wires it to its own log — App
     * Insights (Azure) / function logs (Supabase) — so production golden signals
     * (request + error rate, latency per op) are queryable. Best-effort only.
     */
    onEvent?: (event: string, data: Record<string, unknown>) => void;
  } = {},
) {
  // ALLOWED_ORIGIN may be a comma-separated list (e.g. the Static Web App default
  // host plus a custom domain). A single Access-Control-Allow-Origin can name
  // only one origin, so reflect the request's Origin when it's in the list;
  // "Vary: Origin" keeps that cacheable. "*" short-circuits to allow all, and an
  // unlisted origin falls back to the first entry (effectively denied). The
  // caller reads the env in its own runtime and passes it as allowedOrigin.
  const allowed = (opts.allowedOrigin ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const pickOrigin = (reqOrigin?: string): string =>
    allowed.includes("*")
      ? "*"
      : reqOrigin && allowed.includes(reqOrigin)
        ? reqOrigin
        : (allowed[0] ?? "*");
  const provider = opts.provider ?? "Azure";
  const rateLimiter = opts.rateLimiter;
  const cors = (reqOrigin?: string): Record<string, string> => ({
    "Access-Control-Allow-Origin": pickOrigin(reqOrigin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": opts.allowedHeaders ?? "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  const onEvent = opts.onEvent;
  // Log the mutating ops always; skip successful high-frequency reads (state
  // polls, version/health probes) to keep log volume + cost sane. Failures
  // (4xx/5xx) are logged for every op regardless.
  const LOGGED_OPS = new Set(["create", "join", "start", "act"]);

  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (key: string, max: number, windowMs: number): boolean => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || now > e.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
      return false;
    }
    e.n += 1;
    return e.n > max;
  };

  return async function route(req: RawRequest): Promise<RawResponse> {
    const t0 = Date.now();
    let op = "";
    const corsHeaders = cors(req.origin);
    const reply = (status: number, body: unknown): RawResponse => {
      if (onEvent && (LOGGED_OPS.has(op) || status >= 400))
        onEvent("request", { op, status, ms: Date.now() - t0 });
      return { status, headers: { ...corsHeaders, "Content-Type": "application/json" }, body };
    };
    if (req.method === "OPTIONS") return { status: 204, headers: corsHeaders };
    if (req.method !== "POST") return reply(405, { error: "POST only." });

    if (limited(req.ip, 90, 60_000))
      return reply(429, { error: "Too many requests — please slow down." });

    let body: Record<string, unknown>;
    try {
      body = (await req.readJson()) as Record<string, unknown>;
    } catch {
      return reply(400, { error: "We couldn't read that request." });
    }

    op = String(body?.op ?? "");

    // Wire-protocol gate. Clients tag each request with their PROTOCOL_VERSION;
    // if it's present and doesn't match this server's, the client is stale
    // across a breaking deploy — tell it to refresh (426) rather than letting it
    // misparse a changed response shape. `version`/`health` are exempt so the
    // client can still discover the mismatch. A missing field is allowed
    // (older clients / manual callers), so this is backward compatible.
    if (
      typeof body?.protocol === "number" &&
      body.protocol !== PROTOCOL_VERSION &&
      op !== "version" &&
      op !== "health"
    )
      return reply(426, { error: "A new version is available — please refresh the page." });

    if (op === "version") return reply(200, handleVersion(provider).body);
    if (op === "health") {
      const r = await handleHealth(store, provider);
      return reply(r.status, r.body);
    }
    if (op === "clientError") return reply(200, handleClientError(body).body);

    if (op === "create") {
      // Cheap per-instance first line, then the durable shared caps (per-IP/hour
      // + global/day) that actually bound cost across all Function instances.
      if (limited(`create:${req.ip}`, 15, 600_000))
        return reply(429, {
          error: "You're creating games too quickly — try again in a few minutes.",
        });
      if (rateLimiter && !(await rateLimiter.allowCreate(req.ip, new Date().toISOString())))
        return reply(429, {
          error: "Too many games are being created right now — please try again later.",
        });
    }

    if (op === "act") {
      // Per-seat write cap. Each APPLIED act commits new state AND broadcasts a
      // change ping, so `act` is the real amplification vector — a valid seat
      // holder could otherwise hammer it, and from rotating IPs the per-IP cap
      // above can't catch it. The seat token can't rotate, so cap on that. Human
      // play is a couple of acts per turn, so this ceiling is generous headroom
      // that only bites abuse. Per-instance + implicitly fail-open, matching the
      // other lightweight limiters (rate limiting here is best-effort by design).
      const seatToken = typeof body.seatToken === "string" ? body.seatToken : "";
      if (seatToken && limited(`act:${seatToken}`, 30, 10_000))
        return reply(429, { error: "You're acting too quickly — please slow down." });
    }

    const fn = OPS[op];
    if (!fn) return reply(400, { error: "Unsupported request." });

    try {
      const { status, body: out } = await fn(store, body);
      return reply(status, out);
    } catch (e) {
      // A state that outgrew the persistence size cap is a specific, actionable
      // failure — surface it clearly instead of a silent generic 500 so it
      // isn't invisible in logs and the client gets a meaningful message.
      if (e instanceof StateTooLargeError) {
        console.error(`game op=${op} state-too-large: ${e.message}`);
        return reply(507, {
          error: "This game has grown too large to continue. Please start a new one.",
        });
      }
      // Log the real cause server-side (App Insights captures console.error);
      // the client only ever sees a generic message. Include the gameId so a
      // single stuck game's errors can be correlated (e.g. a persisted state that
      // an engine change can no longer read — see handlers' engine guard).
      const gid = typeof body?.gameId === "string" ? body.gameId : "-";
      console.error(`game op=${op} game=${gid} failed:`, (e as Error)?.stack ?? e);
      return reply(500, {
        error: "Something went wrong on our end. Please try again.",
      });
    }
  };
}
