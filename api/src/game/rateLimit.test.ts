import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeMemoryRateLimiter } from "./rateLimit.js";

const ENV = process.env;
beforeEach(() => {
  process.env = {
    ...ENV,
    MAX_GAMES_PER_DAY: "5",
    MAX_GAMES_PER_IP_PER_HOUR: "2",
  };
});
afterEach(() => {
  process.env = ENV;
});

const T = "2026-06-28T10:00:00.000Z";

describe("rate limiter (memory)", () => {
  it("caps creates per IP per hour", async () => {
    const rl = makeMemoryRateLimiter();
    expect(await rl.allowCreate("1.1.1.1", T)).toBe(true);
    expect(await rl.allowCreate("1.1.1.1", T)).toBe(true);
    expect(await rl.allowCreate("1.1.1.1", T)).toBe(false); // 3rd in the hour, cap is 2
  });

  it("tracks IPs independently", async () => {
    const rl = makeMemoryRateLimiter();
    await rl.allowCreate("1.1.1.1", T);
    await rl.allowCreate("1.1.1.1", T);
    expect(await rl.allowCreate("1.1.1.1", T)).toBe(false);
    expect(await rl.allowCreate("2.2.2.2", T)).toBe(true); // a different IP is fresh
  });

  it("resets the per-IP cap in a new hour", async () => {
    const rl = makeMemoryRateLimiter();
    await rl.allowCreate("1.1.1.1", "2026-06-28T10:30:00Z");
    await rl.allowCreate("1.1.1.1", "2026-06-28T10:45:00Z");
    expect(await rl.allowCreate("1.1.1.1", "2026-06-28T10:59:00Z")).toBe(false);
    expect(await rl.allowCreate("1.1.1.1", "2026-06-28T11:00:00Z")).toBe(true); // new hour
  });

  it("enforces the GLOBAL daily ceiling across all IPs", async () => {
    process.env.MAX_GAMES_PER_IP_PER_HOUR = "100"; // take per-IP out of the way
    const rl = makeMemoryRateLimiter();
    let ok = 0;
    for (let i = 0; i < 8; i++) {
      if (await rl.allowCreate(`10.0.0.${i}`, T)) ok++; // each a distinct IP
    }
    expect(ok).toBe(5); // global cap is 5/day regardless of source
  });
});
