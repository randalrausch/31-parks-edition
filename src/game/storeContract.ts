/**
 * Shared GameStore contract. Every storage adapter (MemoryGameStore,
 * TableGameStore, SupabaseGameStore) must satisfy the SAME behavioral contract —
 * atomic create, code collisions, optimistic-concurrency CAS, redaction-safe
 * reads. Encoding it once and running it against each adapter turns "the two
 * backends behave identically" from a review assertion into a failing test if
 * they ever drift.
 *
 * Call `runStoreContract(makeStore)` inside a `describe`. `makeStore` returns a
 * fresh (or freshly-namespaced) store; fixtures use random ids/codes so the same
 * contract works against a shared real table without cross-test collisions.
 */
import { it, expect } from "vitest";
import { createGameState } from "./actions";
import { CodeCollisionError, type GameRecord, type GameStore, type SecretRecord } from "./store";
import { DEFAULT_OPTIONS } from "./engine";

function fixtures(): { rec: GameRecord; secret: SecretRecord } {
  const gameId = crypto.randomUUID();
  const code = gameId
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase()
    .padEnd(6, "A");
  const state = createGameState(
    [
      { id: "p0", name: "Host", isAI: false, avatarKey: "ranger" },
      { id: "p1", name: "Bot", isAI: true, avatarKey: "ranger" },
    ],
    DEFAULT_OPTIONS,
  );
  const now = "2026-06-28T00:00:00.000Z";
  const rec: GameRecord = {
    gameId,
    code,
    status: "lobby",
    version: 0,
    seats: [{ idx: 0, name: "Host", avatar: "ranger", isAI: false, filled: true }],
    createdAt: now,
    updatedAt: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const secret: SecretRecord = { state, seatTokens: { "tok-host": 0 } };
  return { rec, secret };
}

export function runStoreContract(makeStore: () => GameStore | Promise<GameStore>): void {
  it("creates a game and reads it back by code and id", async () => {
    const store = await makeStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);

    expect(await store.getByCode(rec.code)).toBe(rec.gameId);
    expect(await store.getByCode(rec.code.toLowerCase())).toBe(rec.gameId); // case-insensitive
    const got = await store.getGame(rec.gameId);
    expect(got?.rec.gameId).toBe(rec.gameId);
    expect(got?.rec.code).toBe(rec.code);
    const sec = await store.getSecret(rec.gameId);
    expect(sec?.seatTokens).toEqual({ "tok-host": 0 });
  });

  it("returns null for a missing code / game / secret", async () => {
    const store = await makeStore();
    expect(await store.getByCode("ZZZZZ9")).toBeNull();
    expect(await store.getGame(crypto.randomUUID())).toBeNull();
    expect(await store.getSecret(crypto.randomUUID())).toBeNull();
  });

  it("raises CodeCollisionError when the code is already taken", async () => {
    const store = await makeStore();
    const a = fixtures();
    const b = fixtures();
    b.rec.code = a.rec.code; // force a collision on a different gameId
    await store.createGame(a.rec, a.secret);
    await expect(store.createGame(b.rec, b.secret)).rejects.toBeInstanceOf(CodeCollisionError);
    // The original game is untouched.
    expect(await store.getByCode(a.rec.code)).toBe(a.rec.gameId);
  });

  it("CAS: update with the current etag succeeds and rotates it", async () => {
    const store = await makeStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { etag } = (await store.getGame(rec.gameId))!;
    const next = { ...rec, status: "playing", version: rec.version + 1 };
    expect(await store.update(rec.gameId, etag, next, secret)).toBe(true);
    const after = await store.getGame(rec.gameId);
    expect(after?.rec.status).toBe("playing");
    expect(after?.etag).not.toBe(etag);
  });

  it("CAS: a stale etag loses the race (no half-commit)", async () => {
    const store = await makeStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { etag: stale } = (await store.getGame(rec.gameId))!;
    // A concurrent writer bumps first.
    await store.update(rec.gameId, stale, { ...rec, version: 1 }, secret);
    // Our write with the now-stale etag must lose, and leave the winner's state.
    expect(await store.update(rec.gameId, stale, { ...rec, version: 99 }, secret)).toBe(false);
    expect((await store.getGame(rec.gameId))?.rec.version).toBe(1);
  });
}
