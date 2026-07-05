/**
 * Local in-memory game server for the PR-time online E2E.
 *
 * Hosts the SAME shared op layer both production backends run — makeRouter over
 * a GameStore (here the in-memory test store) — behind a plain node:http server,
 * so a real browser can play a full online round (create → join → start → act)
 * with no cloud credentials. The client talks to it through the Azure code path:
 * `.env.e2e` bakes VITE_API_BASE=http://127.0.0.1:8787/api into the e2e build,
 * and azureClient.ts POSTs to `${base}/game`; NetworkTransport's safety-net poll
 * drives convergence (no push channel needed, same as production Azure).
 *
 * Started by Playwright's webServer (playwright.config.ts) via `npm run
 * e2e:server`, which bundles this file with esbuild (it imports TypeScript from
 * src/) and runs the output with plain Node.
 */
import http from "node:http";
import { makeRouter } from "../src/game/router";
import { makeMemoryStore } from "../src/game/memoryStore";

const PORT = 8787;

const route = makeRouter(makeMemoryStore(), {
  // The page is served from a different origin (the vite preview on :4321).
  allowedOrigin: "*",
  provider: "Local E2E",
});

const server = http.createServer((req, res) => {
  // Readiness probe for Playwright's webServer wait (the router is POST-only).
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    void (async () => {
      const out = await route({
        method: req.method ?? "GET",
        ip: req.socket.remoteAddress ?? "127.0.0.1",
        origin: req.headers.origin,
        readJson: () => Promise.resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body === undefined ? undefined : JSON.stringify(out.body));
    })().catch((e: unknown) => {
      // The router catches op errors itself; this only guards transport bugs.
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] local in-memory game server listening on http://127.0.0.1:${PORT}`);
});
