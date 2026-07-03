import { describe, it, expect } from "vitest";
import { makeMemoryStore } from "./memoryStore";
import { createGameState } from "./actions";
import { CodeCollisionError, type GameRecord, type SecretRecord } from "./store";

function fixtures(overrides: Partial<GameRecord> = {}) {
  const state = createGameState(
    [
      { id: "p0", name: "Host", isAI: false, avatarKey: "ranger" },
      { id: "p1", name: "Bot", isAI: true, avatarKey: "ranger" },
    ],
    {
      threeOfAKind: false,
      grace: true,
      knockPenalty: true,
      sound: false,
      showLog: true,
      fullHistory: false,
    },
  );
  const rec: GameRecord = {
    gameId: "g1",
    code: "ABCDE",
    status: "lobby",
    version: 0,
    seats: [
      { idx: 0, name: "Host", avatar: "ranger", isAI: false, filled: true },
      { idx: 1, name: "Bot", avatar: "ranger", isAI: true, filled: true },
    ],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    expiresAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
  const secret: SecretRecord = { state, seatTokens: { "tok-host": 0 } };
  return { rec, secret };
}

describe("GameStore (memory)", () => {
  it("creates a game and resolves it by code (case-insensitive)", async () => {
    const store = makeMemoryStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    expect(await store.getByCode("ABCDE")).toBe("g1");
    expect(await store.getByCode("abcde")).toBe("g1");
    expect(await store.getByCode("ZZZZZ")).toBeNull();
  });

  it("raises CodeCollisionError when the code is already taken", async () => {
    const store = makeMemoryStore();
    const a = fixtures({ gameId: "g1", code: "ABCDE1" });
    const b = fixtures({ gameId: "g2", code: "abcde1" }); // same code, different case
    await store.createGame(a.rec, a.secret);
    await expect(store.createGame(b.rec, b.secret)).rejects.toBeInstanceOf(CodeCollisionError);
    expect(await store.getByCode("ABCDE1")).toBe("g1"); // original untouched
  });

  it("returns the record with an etag and the secret", async () => {
    const store = makeMemoryStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const got = await store.getGame("g1");
    expect(got?.rec.code).toBe("ABCDE");
    expect(typeof got?.etag).toBe("string");
    const sec = await store.getSecret("g1");
    expect(sec?.seatTokens).toEqual({ "tok-host": 0 });
  });

  it("update with the current etag succeeds and rotates the etag", async () => {
    const store = makeMemoryStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { rec: r0, etag } = (await store.getGame("g1"))!;
    const next = { ...r0, status: "playing", version: r0.version + 1 };
    expect(await store.update("g1", etag, next, secret)).toBe(true);
    const after = await store.getGame("g1");
    expect(after?.rec.status).toBe("playing");
    expect(after?.etag).not.toBe(etag); // etag rotated
  });

  it("update with a stale etag fails (lost the CAS race)", async () => {
    const store = makeMemoryStore();
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    const { rec: r0, etag: stale } = (await store.getGame("g1"))!;
    // A concurrent writer bumps first.
    await store.update("g1", stale, { ...r0, version: 1 }, secret);
    // Our write with the now-stale etag must lose.
    expect(await store.update("g1", stale, { ...r0, version: 99 }, secret)).toBe(false);
    expect((await store.getGame("g1"))?.rec.version).toBe(1);
  });

  it("deleteExpired removes only games past expiresAt and clears the code index", async () => {
    const store = makeMemoryStore();
    const live = fixtures({
      gameId: "live",
      code: "LIVE1",
      expiresAt: "2026-07-12T00:00:00.000Z",
    });
    const dead = fixtures({
      gameId: "dead",
      code: "DEAD1",
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    await store.createGame(live.rec, live.secret);
    await store.createGame(dead.rec, dead.secret);
    const removed = await store.deleteExpired("2026-06-28T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(await store.getGame("dead")).toBeNull();
    expect(await store.getByCode("DEAD1")).toBeNull();
    expect(await store.getGame("live")).not.toBeNull();
  });
});
