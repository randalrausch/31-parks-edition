/**
 * Durable, cross-instance rate limiting for the costly `create` op — the main
 * cost-amplification vector (anonymous, allocates new storage). Two ceilings:
 *
 *   - GLOBAL games/day  — a hard cap on total games created per day, so no amount
 *     of distributed spam can drive unbounded Function executions / storage.
 *   - PER-IP games/hour — stops a single source flooding.
 *
 * Counters live in Table Storage (shared across the ephemeral Function instances,
 * unlike the per-instance limiter in router.ts which is just a cheap first line).
 * Both caps are configurable via env (MAX_GAMES_PER_DAY / MAX_GAMES_PER_IP_PER_HOUR).
 *
 * Fail-open on storage errors: a transient Table hiccup must not lock players out;
 * the Function scale-out cap (infra) still bounds the worst case independently.
 */
import { RestError, type TableClient } from "@azure/data-tables";
import { tableClient } from "./tableStore.js";

export interface RateLimiter {
  /** True if a create from `ip` at `nowIso` is within both caps (and records it). */
  allowCreate(ip: string, nowIso: string): Promise<boolean>;
}

/** A counter store: atomically increment (pk,rk) iff still below `limit`. */
interface Counter {
  incrIfBelow(pk: string, rk: string, limit: number): Promise<boolean>;
}

const maxPerDay = () => Number(process.env.MAX_GAMES_PER_DAY) || 500;
const maxPerIpHour = () => Number(process.env.MAX_GAMES_PER_IP_PER_HOUR) || 20;
// Table key segments can't contain / \ # ? or control chars.
const safe = (s: string) => s.replace(/[^A-Za-z0-9.:_-]/g, "_").slice(0, 200);

function makeLimiter(counter: Counter): RateLimiter {
  return {
    async allowCreate(ip, nowIso) {
      const day = nowIso.slice(0, 10); // YYYY-MM-DD
      const hour = nowIso.slice(0, 13); // YYYY-MM-DDTHH
      if (!(await counter.incrIfBelow("global", `d:${day}`, maxPerDay())))
        return false;
      return counter.incrIfBelow("ip", `${safe(ip)}:${hour}`, maxPerIpHour());
    },
  };
}

/** In-memory counter for tests. */
export function makeMemoryRateLimiter(): RateLimiter {
  const counts = new Map<string, number>();
  return makeLimiter({
    async incrIfBelow(pk, rk, limit) {
      const key = `${pk}|${rk}`;
      const n = counts.get(key) ?? 0;
      if (n >= limit) return false;
      counts.set(key, n + 1);
      return true;
    },
  });
}

const isStatus = (e: unknown, code: number) =>
  e instanceof RestError && e.statusCode === code;

/** Table Storage counter with ETag CAS + bounded retry; fail-open on infra errors. */
export function makeTableRateLimiter(): RateLimiter {
  let client: TableClient | null = null;
  const ready = (async () => {
    client = tableClient("Rate");
    try {
      await client.createTable();
    } catch (e) {
      if (!isStatus(e, 409)) throw e;
    }
  })();

  return makeLimiter({
    async incrIfBelow(pk, rk, limit) {
      try {
        await ready;
        const c = client!;
        for (let attempt = 0; attempt < 5; attempt++) {
          let count = 0;
          let etag: string | undefined;
          try {
            const e = await c.getEntity<{ count: number }>(pk, rk);
            count = Number(e.count) || 0;
            etag = e.etag;
          } catch (e) {
            if (!isStatus(e, 404)) throw e;
          }
          if (count >= limit) return false; // over the cap
          try {
            if (etag) {
              await c.updateEntity(
                { partitionKey: pk, rowKey: rk, count: count + 1 },
                "Replace",
                { etag },
              );
            } else {
              await c.createEntity({ partitionKey: pk, rowKey: rk, count: 1 });
            }
            return true;
          } catch (e) {
            // Lost the race (412) or a duplicate create (409) — re-read and retry.
            if (isStatus(e, 412) || isStatus(e, 409)) continue;
            throw e;
          }
        }
        return true; // contention exhausted retries — fail open
      } catch {
        return true; // storage error — fail open (scale-out cap still bounds cost)
      }
    },
  });
}
