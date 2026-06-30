/**
 * Integration tests for TableGameStore against Azurite (local Table emulator).
 *
 * Run with Azurite up (the api `pretest` / CI starts it). If TABLES_CONNECTION
 * is unset or Azurite is unreachable, the suite SKIPS so plain unit runs stay
 * green without the emulator.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TableServiceClient } from "@azure/data-tables";
import { createGameState } from "./engine.js";
import type { GameRecord, SecretRecord } from "./store.js";

const CONN = process.env.TABLES_CONNECTION;

async function azuriteReachable(): Promise<boolean> {
  if (!CONN) return false;
  try {
    const svc = TableServiceClient.fromConnectionString(CONN, {
      allowInsecureConnection: true,
    });
    // Listing tables forces a round-trip; throws if the emulator is down.
    await svc.listTables().next();
    return true;
  } catch {
    return false;
  }
}

let up = false;
beforeAll(async () => {
  up = await azuriteReachable();
  if (!up)
    console.warn("Azurite not reachable — skipping TableGameStore suite.");
});

function fixtures(): { rec: GameRecord; secret: SecretRecord } {
  const id = crypto.randomUUID();
  const code = id.slice(0, 5).toUpperCase();
  const state = createGameState(
    [
      { id: "p0", name: "Host", isAI: false, avatarKey: "ranger" },
      { id: "p1", name: "Bot", isAI: true, avatarKey: "ranger" },
    ],
    { threeOfAKind: false, grace: true, knockPenalty: true, sound: false, showLog: true },
  );
  return {
    rec: {
      gameId: id,
      code,
      status: "lobby",
      version: 0,
      seats: [
        { idx: 0, name: "Host", avatar: "ranger", isAI: false, filled: true },
        { idx: 1, name: "Bot", avatar: "ranger", isAI: true, filled: true },
      ],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      expiresAt: "2026-07-12T00:00:00.000Z",
    },
    secret: { state, seatTokens: { "tok-host": 0 } },
  };
}

describe("TableGameStore (Azurite)", () => {
  it("create + getByCode + getGame/getSecret round-trip", async ({ skip }) => {
    if (!up) return skip();
    const { makeTableStore } = await import("./tableStore.js");
    const store = makeTableStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    expect(await store.getByCode(rec.code)).toBe(rec.gameId);
    const got = await store.getGame(rec.gameId);
    expect(got?.rec.code).toBe(rec.code);
    expect(typeof got?.etag).toBe("string");
    const sec = await store.getSecret(rec.gameId);
    expect(sec?.seatTokens).toEqual({ "tok-host": 0 });
  });

  it("atomic batch update succeeds with the current etag and rotates it", async ({
    skip,
  }) => {
    if (!up) return skip();
    const { makeTableStore } = await import("./tableStore.js");
    const store = makeTableStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { rec: r0, etag } = (await store.getGame(rec.gameId))!;
    const ok = await store.update(
      rec.gameId,
      etag,
      { ...r0, status: "playing", version: 1 },
      secret,
    );
    expect(ok).toBe(true);
    const after = await store.getGame(rec.gameId);
    expect(after?.rec.status).toBe("playing");
    expect(after?.etag).not.toBe(etag);
  });

  it("update with a stale etag loses the CAS race (no half-commit)", async ({
    skip,
  }) => {
    if (!up) return skip();
    const { makeTableStore } = await import("./tableStore.js");
    const store = makeTableStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { rec: r0, etag: stale } = (await store.getGame(rec.gameId))!;
    await store.update(rec.gameId, stale, { ...r0, version: 1 }, secret); // winner
    const lost = await store.update(
      rec.gameId,
      stale,
      { ...r0, version: 99 },
      secret,
    );
    expect(lost).toBe(false);
    expect((await store.getGame(rec.gameId))?.rec.version).toBe(1);
  });

  it("deleteExpired removes past-expiry games and their code index", async ({
    skip,
  }) => {
    if (!up) return skip();
    const { makeTableStore } = await import("./tableStore.js");
    const store = makeTableStore();
    const live = fixtures();
    const dead = fixtures();
    dead.rec.expiresAt = "2026-06-01T00:00:00.000Z";
    await store.createGame(live.rec, live.secret);
    await store.createGame(dead.rec, dead.secret);
    const removed = await store.deleteExpired("2026-06-28T00:00:00.000Z");
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await store.getGame(dead.rec.gameId)).toBeNull();
    expect(await store.getByCode(dead.rec.code)).toBeNull();
    expect(await store.getGame(live.rec.gameId)).not.toBeNull();
  });
});
