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
import { makeRouter } from "./router.js";
import { sweep } from "./game/cleanup.js";
import { initTelemetry } from "./telemetry.js";

initTelemetry();

const store = makeTableStore();
const route = makeRouter(store);

const clientIp = (req: HttpRequest): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

app.http("game", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "game",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const res = await route({
      method: req.method,
      ip: clientIp(req),
      readJson: () => req.json(),
    });
    return { status: res.status, headers: res.headers, jsonBody: res.body };
  },
});

// Daily reaper for abandoned games (keeps the free-tier Storage account bounded).
app.timer("cleanup", {
  schedule: "0 0 3 * * *", // 03:00 UTC daily
  handler: async (_t: Timer, ctx: InvocationContext): Promise<void> => {
    const removed = await sweep(store, new Date().toISOString());
    ctx.log(`cleanup: removed ${removed} expired game(s)`);
  },
});
