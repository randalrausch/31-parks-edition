/**
 * Azure Functions entry point — the authority's single HTTP endpoint.
 *
 *   POST /api/game   body { op, ... }   (anonymous; per-seat tokens are the auth)
 *
 * Thin adapter: builds the store, then delegates to the framework-free router
 * (op dispatch + CORS + rate limiting). Function registrations live here so the
 * Functions host discovers them when it loads `main`.
 */
import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { makeTableStore } from "./game/tableStore.js";
import { makeRouter } from "./router.js";

const route = makeRouter(makeTableStore());

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
