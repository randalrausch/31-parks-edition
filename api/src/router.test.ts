import { describe, it, expect } from "vitest";
import { makeRouter, type RawRequest } from "./router.js";
import { makeMemoryStore } from "./game/memoryStore.js";
import { makeMemoryRateLimiter } from "./game/rateLimit.js";

const post = (body: unknown, ip = "1.2.3.4", origin?: string): RawRequest => ({
  method: "POST",
  ip,
  origin,
  readJson: async () => body,
});

describe("router", () => {
  it("answers OPTIONS preflight with 204 + CORS, no body", async () => {
    const route = makeRouter(makeMemoryStore(), {
      allowedOrigin: "https://x.app",
    });
    const res = await route({
      method: "OPTIONS",
      ip: "1.1.1.1",
      readJson: async () => ({}),
    });
    expect(res.status).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://x.app");
    expect(res.body).toBeUndefined();
  });

  it("adds CORS to normal responses", async () => {
    const route = makeRouter(makeMemoryStore(), {
      allowedOrigin: "https://x.app",
    });
    const res = await route(post({ op: "version" }));
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://x.app");
    expect((res.body as { provider: string }).provider).toBe("Azure");
  });

  it("reflects the caller's origin when it's in the allowed list", async () => {
    const route = makeRouter(makeMemoryStore(), {
      allowedOrigin: "https://swa.azurestaticapps.net, https://play31.fun",
    });
    const swa = await route(
      post({ op: "version" }, "1.2.3.4", "https://swa.azurestaticapps.net"),
    );
    expect(swa.headers["Access-Control-Allow-Origin"]).toBe(
      "https://swa.azurestaticapps.net",
    );
    const apex = await route(
      post({ op: "version" }, "1.2.3.4", "https://play31.fun"),
    );
    expect(apex.headers["Access-Control-Allow-Origin"]).toBe(
      "https://play31.fun",
    );
  });

  it("falls back to the first allowed origin for a non-allowed caller", async () => {
    const route = makeRouter(makeMemoryStore(), {
      allowedOrigin: "https://play31.fun, https://swa.azurestaticapps.net",
    });
    const res = await route(
      post({ op: "version" }, "1.2.3.4", "https://evil.example.com"),
    );
    // Not the caller's origin → the browser blocks the response, as intended.
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      "https://play31.fun",
    );
  });

  it("allows any origin when configured with '*'", async () => {
    const route = makeRouter(makeMemoryStore(), { allowedOrigin: "*" });
    const res = await route(
      post({ op: "version" }, "1.2.3.4", "https://anything.example"),
    );
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("rejects unknown ops with 400", async () => {
    const route = makeRouter(makeMemoryStore());
    expect((await route(post({ op: "nope" }))).status).toBe(400);
  });

  it("rejects unreadable JSON with 400", async () => {
    const route = makeRouter(makeMemoryStore());
    const res = await route({
      method: "POST",
      ip: "1.1.1.1",
      readJson: async () => {
        throw new Error("bad json");
      },
    });
    expect(res.status).toBe(400);
  });

  it("routes create through to the handler", async () => {
    const route = makeRouter(makeMemoryStore());
    const res = await route(
      post({
        op: "create",
        config: { creatorName: "R", humans: 2, ai: [], options: {} },
      }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { code: string }).code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it("enforces the durable rate limiter on create (global/per-IP cap)", async () => {
    process.env.MAX_GAMES_PER_DAY = "2";
    process.env.MAX_GAMES_PER_IP_PER_HOUR = "100";
    const route = makeRouter(makeMemoryStore(), {
      rateLimiter: makeMemoryRateLimiter(),
    });
    const mk = () =>
      route(
        post(
          {
            op: "create",
            config: { creatorName: "R", humans: 2, ai: [], options: {} },
          },
          "5.5.5.5",
        ),
      );
    expect((await mk()).status).toBe(200);
    expect((await mk()).status).toBe(200);
    expect((await mk()).status).toBe(429); // global daily cap of 2 hit
    delete process.env.MAX_GAMES_PER_DAY;
    delete process.env.MAX_GAMES_PER_IP_PER_HOUR;
  });

  it("rate-limits excessive create from one IP", async () => {
    const route = makeRouter(makeMemoryStore());
    let last = 200;
    for (let i = 0; i < 20; i++) {
      last = (
        await route(
          post(
            {
              op: "create",
              config: { creatorName: "R", humans: 2, ai: [], options: {} },
            },
            "9.9.9.9",
          ),
        )
      ).status;
    }
    expect(last).toBe(429); // create cap is 15 / 10 min per IP
  });
});
