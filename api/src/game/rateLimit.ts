/**
 * Azure Table Storage rate-limit counter for the `create` op. The shared
 * day/hour bucketing and the two ceilings live in src/game/rateLimit.ts; this
 * supplies the durable, cross-instance Counter (ETag CAS with bounded retry) and
 * reads the configurable limits from the environment. Fail-open on infra errors:
 * a transient Table hiccup must not lock players out; the Function scale-out cap
 * (infra) still bounds the worst case independently.
 */
import { RestError, type TableClient } from "@azure/data-tables";
import { tableClient } from "./tableStore.js";
import { makeLimiter, type Counter, type RateLimiter } from "../../../src/game/rateLimit";

const maxPerDay = () => Number(process.env.MAX_GAMES_PER_DAY) || 500;
const maxPerIpHour = () => Number(process.env.MAX_GAMES_PER_IP_PER_HOUR) || 20;

const isStatus = (e: unknown, code: number) => e instanceof RestError && e.statusCode === code;

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

  const counter: Counter = {
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
              await c.updateEntity({ partitionKey: pk, rowKey: rk, count: count + 1 }, "Replace", {
                etag,
              });
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
  };

  return makeLimiter(counter, maxPerDay(), maxPerIpHour());
}
