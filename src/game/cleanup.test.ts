import { describe, it, expect } from "vitest";
import { sweep } from "./cleanup";
import { makeMemoryStore } from "./memoryStore";
import { createGameState } from "./actions";
import type { GameRecord, SecretRecord } from "./store";

function game(id: string, expiresAt: string): { rec: GameRecord; secret: SecretRecord } {
  const state = createGameState([{ id: "p0", name: "H", isAI: false, avatarKey: "ranger" }], {
    threeOfAKind: false,
    grace: true,
    knockPenalty: true,
    sound: false,
    showLog: true,
    fullHistory: false,
  });
  return {
    rec: {
      gameId: id,
      code: id.toUpperCase().slice(0, 5).padEnd(5, "A"),
      status: "lobby",
      version: 0,
      seats: [{ idx: 0, name: "H", avatar: "ranger", isAI: false, filled: true }],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      expiresAt,
    },
    secret: { state, seatTokens: { t: 0 } },
  };
}

describe("sweep", () => {
  it("removes only games past expiry and returns the count", async () => {
    const store = makeMemoryStore();
    const dead = game("dead1", "2026-06-10T00:00:00.000Z");
    const live = game("live1", "2026-12-31T00:00:00.000Z");
    await store.createGame(dead.rec, dead.secret);
    await store.createGame(live.rec, live.secret);

    const removed = await sweep(store, "2026-06-28T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(await store.getGame("dead1")).toBeNull();
    expect(await store.getGame("live1")).not.toBeNull();
  });
});
