/**
 * Integration test for the Rate-counter reaper against Azurite. Same honesty
 * gate as tableStore.test.ts: runs when TABLES_CONNECTION is set (CI), skips on
 * a plain local unit run, and FAILS if a connection is configured but the
 * emulator is unreachable.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TableServiceClient } from "@azure/data-tables";
import { makeTableRateLimiter, reapRateCounters } from "./rateLimit";

const CONN = process.env.TABLES_CONNECTION;

async function azuriteReachable(): Promise<boolean> {
  if (!CONN) return false;
  try {
    const svc = TableServiceClient.fromConnectionString(CONN, { allowInsecureConnection: true });
    await svc.listTables().next();
    return true;
  } catch {
    return false;
  }
}

let up = false;
beforeAll(async () => {
  up = await azuriteReachable();
  if (CONN && !up) {
    throw new Error(
      "TABLES_CONNECTION is set but Azurite is unreachable — the rate-counter " +
        "reaper suite must run when a connection is configured (CI).",
    );
  }
  if (!up) console.warn("Azurite not reachable — skipping rate-counter reaper suite.");
});

describe("reapRateCounters (Azurite)", () => {
  it("deletes rows older than the cutoff and leaves fresh ones", async ({ skip }) => {
    if (!up) return skip();
    // Seed a few counter rows via the limiter (writes to the Rate table).
    const rl = makeTableRateLimiter();
    const now = new Date().toISOString();
    await rl.allowCreate("203.0.113.1", now);
    await rl.allowCreate("203.0.113.2", now);

    // A cutoff in the past reaps nothing (rows are brand new).
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(await reapRateCounters(past)).toBe(0);

    // A cutoff in the future is "older than everything" → reaps all rows.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const removed = await reapRateCounters(future);
    expect(removed).toBeGreaterThanOrEqual(2);

    // Table is now empty of counters → a second future reap removes nothing.
    expect(await reapRateCounters(future)).toBe(0);
  });

  it("treats a missing Rate table as zero", async ({ skip }) => {
    if (!up) return skip();
    // Delete the table entirely, then reap — must not throw.
    const svc = TableServiceClient.fromConnectionString(CONN as string, {
      allowInsecureConnection: true,
    });
    try {
      await svc.deleteTable("Rate");
    } catch {
      /* already absent */
    }
    expect(await reapRateCounters(new Date().toISOString())).toBe(0);
  });
});
