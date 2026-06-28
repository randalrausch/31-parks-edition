import { describe, it, expect } from "vitest";
import { makeRouter, type RawRequest } from "./router.js";
import { makeMemoryStore } from "./game/memoryStore.js";

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
