/**
 * Azure Table Storage rate-limit counter for the `create` op. The shared
 * day/hour bucketing and the two ceilings live in src/game/rateLimit.ts; this
 * supplies the durable, cross-instance Counter (ETag CAS with bounded retry) and
 * reads the configurable limits from the environment. Fail-open on infra errors:
 * a transient Table hiccup must not lock players out; the Function scale-out cap
 * (infra) still bounds the worst case independently.
 */
import { odata, RestError, type TableClient } from "@azure/data-tables";
import { tableClient } from "./tableStore.js";
import { makeLimiter, type Counter, type RateLimiter } from "../../../src/game/rateLimit";

// Global/day default is a comfortable multiple of one IP's daily max
// (maxPerIpHour*24 = 480) so a single well-behaved source can't nearly exhaust
// the shared budget and deny create to everyone. Both are configurable via env.
const maxPerDay = () => Number(process.env.MAX_GAMES_PER_DAY) || 2000;
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

/**
 * Reap stale rate-counter rows (one per IP-hour / global-day). Unlike Games,
 * the `Rate` table has no expiresAt column and the shared game reaper never
 * touches it, so without this it grows monotonically per distinct IP-hour — a
 * slow but unbounded leak. Mirrors the Supabase pg_cron reaper of rate_counters.
 * Deletes rows whose system Timestamp is older than `olderThanIso`. Returns the
 * number removed; a missing `Rate` table (no creates yet) is treated as 0.
 */
export async function reapRateCounters(olderThanIso: string): Promise<number> {
  const client: TableClient = tableClient("Rate");
  const cutoff = new Date(olderThanIso);
  let n = 0;
  try {
    const stale = client.listEntities({
      queryOptions: { filter: odata`Timestamp lt ${cutoff}` },
    });
    for await (const e of stale) {
      try {
        await client.deleteEntity(e.partitionKey as string, e.rowKey as string);
        n += 1;
      } catch (err) {
        if (!isStatus(err, 404)) throw err; // already gone — fine
      }
    }
  } catch (err) {
    if (isStatus(err, 404)) return 0; // Rate table doesn't exist yet
    throw err;
  }
  return n;
}
