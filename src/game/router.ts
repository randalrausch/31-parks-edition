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
    const corsHeaders = cors(req.origin);
    const reply = (status: number, body: unknown): RawResponse => ({
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body,
    });
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

    const op = String(body?.op ?? "");
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
      // the client only ever sees a generic message.
      console.error(`game op=${op} failed:`, (e as Error)?.stack ?? e);
      return reply(500, {
        error: "Something went wrong on our end. Please try again.",
      });
    }
  };
}
