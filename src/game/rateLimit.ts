/**
 * Durable, cross-instance rate limiting for the costly `create` op — the main
 * cost-amplification vector (anonymous, allocates new storage). Two ceilings:
 *
 *   - GLOBAL games/day  — a hard cap on total games created per day, so no amount
 *     of distributed spam can drive unbounded executions / storage.
 *   - PER-IP games/hour — stops a single source flooding.
 *
 * This module is host-neutral: the actual counter lives behind the `Counter`
 * seam, implemented per backend (Azure Table Storage, Supabase Postgres RPC, or
 * an in-memory map for tests). The concrete limits are passed in by the caller's
 * runtime (env is read there, not here) so this runs unchanged in Node and Deno.
 *
 * Fail-open on storage errors: a transient hiccup must not lock players out; each
 * backend's own scale/cost guard still bounds the worst case independently.
 */

export interface RateLimiter {
  /** True if a create from `ip` at `nowIso` is within both caps (and records it). */
  allowCreate(ip: string, nowIso: string): Promise<boolean>;
}

/** A counter store: atomically increment (pk,rk) iff still below `limit`. */
export interface Counter {
  incrIfBelow(pk: string, rk: string, limit: number): Promise<boolean>;
}

// Key segments can't contain / \ # ? or control chars (Table Storage rules; the
// Postgres counter is unaffected but shares the sanitizer for identical keys).
const safe = (s: string) => s.replace(/[^A-Za-z0-9.:_-]/g, "_").slice(0, 200);

/** Wrap a Counter with the shared day/hour bucketing and the two ceilings. */
export function makeLimiter(
  counter: Counter,
  maxPerDay: number,
  maxPerIpHour: number,
): RateLimiter {
  return {
    async allowCreate(ip, nowIso) {
      const day = nowIso.slice(0, 10); // YYYY-MM-DD
      const hour = nowIso.slice(0, 13); // YYYY-MM-DDTHH
      if (!(await counter.incrIfBelow("global", `d:${day}`, maxPerDay))) return false;
      return counter.incrIfBelow("ip", `${safe(ip)}:${hour}`, maxPerIpHour);
    },
  };
}

/** In-memory counter for tests. Limits are explicit (no env dependency). */
export function makeMemoryRateLimiter(maxPerDay = 500, maxPerIpHour = 20): RateLimiter {
  const counts = new Map<string, number>();
  return makeLimiter(
    {
      async incrIfBelow(pk, rk, limit) {
        const key = `${pk}|${rk}`;
        const n = counts.get(key) ?? 0;
        if (n >= limit) return false;
        counts.set(key, n + 1);
        return true;
      },
    },
    maxPerDay,
    maxPerIpHour,
  );
}
