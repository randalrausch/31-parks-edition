/**
 * Golden serialized-game fixture.
 *
 * The server stores each game's GameState as JSON and refuses to feed a state
 * whose `stateVersion` doesn't match STATE_VERSION back into the engine
 * (handlers.ts → incompatibleState). That guard only helps if STATE_VERSION is
 * actually bumped when the shape breaks — and that bump is human judgment.
 * This test closes the loop: the committed fixture, serialized by the CURRENT
 * STATE_VERSION (regenerate with `npm run fixture:state`), must remain fully
 * playable by the current engine. If an engine change breaks this test,
 * in-flight online games would break the same way — either make the change
 * backward-compatible, or bump STATE_VERSION (CONTRIBUTING.md → Versioning)
 * and regenerate the fixture.
 *
 * (Purely additive fields keep the fixture readable and need no bump — this
 * test stays green. That's by design; see version.ts.)
 */
import { describe, expect, it } from "vitest";
import { applyPlayerAction, redactState } from "./authority";
import type { GameState } from "./engine";
import { STATE_VERSION } from "./version";
import { makeMemoryStore } from "./memoryStore";
import { handleState } from "./handlers";
import fixture from "./__fixtures__/gameState.fixture.json";

const stored = fixture as unknown as GameState;

describe(`a game serialized at STATE_VERSION ${STATE_VERSION} stays playable`, () => {
  it("matches the version the server would accept", () => {
    // A mismatch means STATE_VERSION was bumped without regenerating the
    // fixture: run `npm run fixture:state` and commit the result.
    expect((stored as { stateVersion?: number }).stateVersion ?? 1).toBe(STATE_VERSION);
  });

  it("the current engine still reads, redacts, and advances the stored game", async () => {
    // Redaction still works for a seat and a spectator, conserving all 52 cards.
    const cardCount = (s: GameState) =>
      s.deck.length + s.discard.length + s.players.reduce((n, p) => n + p.hand.length, 0);
    expect(cardCount(stored)).toBe(52);
    for (const viewer of [stored.players[0]!.id, null]) {
      expect(cardCount(redactState(stored, viewer))).toBe(52);
    }

    // The engine can still take the stored game FORWARD — the property an
    // incompatible shape change breaks first.
    const seatId = stored.players[stored.cur]!.id;
    const next = applyPlayerAction(
      stored,
      seatId,
      stored.phase === "drawing"
        ? { type: "drawDeck" }
        : { type: "discard", cardId: stored.players[stored.cur]!.hand[0]!.id },
    );
    expect(next).not.toBe(stored); // the action actually applied

    // And the server-side read path accepts it end to end (version guard + redact).
    const store = makeMemoryStore();
    const now = new Date().toISOString();
    await store.createGame(
      {
        gameId: "fixture-game",
        code: "FIXTUR",
        status: "playing",
        version: 1,
        seats: [],
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { state: stored, seatTokens: { "fixture-token": 0 } },
    );
    const res = await handleState(store, { gameId: "fixture-game", seatToken: "fixture-token" });
    expect(res.status).toBe(200);
  });
});
