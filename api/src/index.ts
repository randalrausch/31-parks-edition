/**
 * Azure Functions entry point — the authority's single HTTP endpoint.
 *
 *   POST /api/game   body { op, ... }   (anonymous; per-seat tokens are the auth)
 *
 * Thin adapter: builds the store, then delegates to the framework-free router
 * (op dispatch + CORS + rate limiting). Function registrations live here so the
 * Functions host discovers them when it loads `main`.
 */
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
  type Timer,
} from "@azure/functions";
import { makeTableStore } from "./game/tableStore.js";
import { makeRouter } from "../../src/game/router";
import { sweep } from "../../src/game/cleanup";
import { clientIp } from "../../src/game/clientIp";
import { makeTableRateLimiter, reapRateCounters } from "./game/rateLimit.js";
import { initTelemetry } from "./telemetry.js";

initTelemetry();

const store = makeTableStore();
const route = makeRouter(store, {
  // ALLOWED_ORIGIN (set as a Function App setting by infra/resources.bicep from
  // the ALLOWED_ORIGINS azd var) is read here and passed in; the router never
  // touches env. Comma-separated list of origins; "*" (the default) allows all.
  // Mirrors the Supabase adapter so CORS behaves identically across backends.
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "*",
  rateLimiter: makeTableRateLimiter(),
  // App Insights auto-collects console output (see telemetry.ts), so this
  // structured line becomes a queryable trace: request + error rate and latency
  // per op. Best-effort; never on the failure path.
  onEvent: (event, data) => console.log(JSON.stringify({ event, ...data })),
});

// App Service appends the real client IP (with :port) as the right-most
// X-Forwarded-For hop; the shared helper takes that hop, never the spoofable
// left-most one. Azure has no trusted single-value proxy header, so pass none.
app.http("game", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "game",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const res = await route({
      method: req.method,
      ip: clientIp(req.headers),
      origin: req.headers.get("origin") ?? undefined,
      readJson: () => req.json(),
    });
    return { status: res.status, headers: res.headers, jsonBody: res.body };
  },
});

// Daily reaper for abandoned games (keeps the free-tier Storage account bounded).
app.timer("cleanup", {
  schedule: "0 0 3 * * *", // 03:00 UTC daily
  handler: async (_t: Timer, ctx: InvocationContext): Promise<void> => {
    // Run the two reaps independently: a failure in one must not skip the other
    // (a broken game sweep used to mean rate rows were never reaped at all).
    const rateCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const [games, rate] = await Promise.allSettled([
      sweep(store, new Date().toISOString()),
      reapRateCounters(rateCutoff),
    ]);
    const removed = games.status === "fulfilled" ? games.value : "error";
    const rateRows = rate.status === "fulfilled" ? rate.value : "error";
    // Structured line so "reaper outcome" is a queryable App Insights trace, not
    // just a log string — an operator can alert on games/rate === "error".
    console.log(JSON.stringify({ event: "reap", games: removed, rate: rateRows }));
    if (games.status === "rejected") ctx.error("cleanup: game sweep failed", games.reason);
    if (rate.status === "rejected") ctx.error("cleanup: rate reap failed", rate.reason);
    ctx.log(`cleanup: removed ${removed} expired game(s), ${rateRows} stale rate row(s)`);
  },
});
