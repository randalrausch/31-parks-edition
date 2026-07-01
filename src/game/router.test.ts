import { describe, it, expect } from "vitest";
import { makeRouter, type RawRequest } from "./router";
import { makeMemoryStore } from "./memoryStore";
import { makeMemoryRateLimiter } from "./rateLimit";

const post = (body: unknown, ip = "1.2.3.4"): RawRequest => ({
  method: "POST",
  ip,
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

  it("routes health through a datastore round-trip (200 healthy)", async () => {
    const route = makeRouter(makeMemoryStore(), { provider: "Supabase" });
    const res = await route(post({ op: "health" }));
    expect(res.status).toBe(200);
    expect((res.body as { healthy: boolean; provider: string }).healthy).toBe(true);
    expect((res.body as { provider: string }).provider).toBe("Supabase");
  });

  it("reflects the request origin when ALLOWED_ORIGIN lists several", async () => {
    const route = makeRouter(makeMemoryStore(), {
      allowedOrigin: "https://a.app, https://b.app",
    });
    const opt = (origin?: string): RawRequest => ({
      method: "OPTIONS",
      ip: "1.1.1.1",
      origin,
      readJson: async () => ({}),
    });
    // an allowed origin is echoed back verbatim
    expect((await route(opt("https://b.app"))).headers["Access-Control-Allow-Origin"]).toBe(
      "https://b.app",
    );
    // an origin not in the list falls back to the first (effectively denied)
    expect((await route(opt("https://evil.app"))).headers["Access-Control-Allow-Origin"]).toBe(
      "https://a.app",
    );
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
    const route = makeRouter(makeMemoryStore(), {
      rateLimiter: makeMemoryRateLimiter(2, 100), // global 2/day, per-IP 100/hr
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

  it("caps act writes per seat token, independent of IP", async () => {
    const route = makeRouter(makeMemoryStore());
    const act = (token: string) =>
      route(
        post({ op: "act", gameId: "g", seatToken: token, action: { type: "drawDeck" } }, "7.7.7.7"),
      );
    let status = 0;
    // First 30 reach the handler (404, no such game); the 31st trips the cap.
    for (let i = 0; i < 31; i++) status = (await act("tok-A")).status;
    expect(status).toBe(429);
    // A different seat token has its own budget — not collateral-damaged.
    expect((await act("tok-B")).status).not.toBe(429);
  });
});
