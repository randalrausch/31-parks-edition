/**
 * Framework-free request router: op dispatch, CORS, and a best-effort per-instance
 * rate limiter — independent of @azure/functions so it's unit-testable. index.ts
 * is a thin adapter from HttpRequest to this.
 */
import {
  handleAct,
  handleCreate,
  handleJoin,
  handleStart,
  handleState,
  handleVersion,
  type OpResult,
} from "./game/handlers.js";
import type { GameStore } from "./game/store.js";
import type { RateLimiter } from "./game/rateLimit.js";

export interface RawRequest {
  method: string;
  ip: string;
  /** The request's `Origin` header, if any — used to reflect an allowed origin. */
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
  opts: { allowedOrigin?: string; rateLimiter?: RateLimiter } = {},
) {
  // ALLOWED_ORIGIN may be a single origin or a comma-separated list (SWA default
  // hostname + any custom domains). "*" (or empty) allows any origin. For a list
  // we reflect the caller's Origin when it's allowed, so a single Function can
  // serve both https://<swa>.azurestaticapps.net and https://play31.fun.
  const originSetting = opts.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? "*";
  const allowedOrigins = originSetting
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAnyOrigin =
    allowedOrigins.length === 0 || allowedOrigins.includes("*");
  const allowOriginFor = (reqOrigin?: string): string => {
    if (allowAnyOrigin) return "*";
    if (reqOrigin && allowedOrigins.includes(reqOrigin)) return reqOrigin;
    // A caller from a non-allowed origin gets the first configured origin, which
    // won't match their Origin — so the browser correctly blocks the response.
    return allowedOrigins[0];
  };
  const rateLimiter = opts.rateLimiter;
  const cors = (reqOrigin?: string): Record<string, string> => ({
    "Access-Control-Allow-Origin": allowOriginFor(reqOrigin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (key: string, max: number, windowMs: number): boolean => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || now > e.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5000)
        for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
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
    if (op === "version") return reply(200, handleVersion().body);

    if (op === "create") {
      // Cheap per-instance first line, then the durable shared caps (per-IP/hour
      // + global/day) that actually bound cost across all Function instances.
      if (limited(`create:${req.ip}`, 15, 600_000))
        return reply(429, {
          error:
            "You're creating games too quickly — try again in a few minutes.",
        });
      if (
        rateLimiter &&
        !(await rateLimiter.allowCreate(req.ip, new Date().toISOString()))
      )
        return reply(429, {
          error:
            "Too many games are being created right now — please try again later.",
        });
    }

    const fn = OPS[op];
    if (!fn) return reply(400, { error: "Unsupported request." });

    try {
      const { status, body: out } = await fn(store, body);
      return reply(status, out);
    } catch {
      return reply(500, {
        error: "Something went wrong on our end. Please try again.",
      });
    }
  };
}
