/**
 * Security property test: redactState must NEVER leak hidden information, across
 * thousands of randomly-driven game states and every viewpoint — each seat AND a
 * null spectator. This is the wire boundary for a hidden-information game, so it
 * gets its own adversarial fuzz on top of the scenario checks in
 * multiplayer.test.ts. Seeded RNG → reproducible failures.
 */
import { describe, it, expect } from "vitest";
import {
  createGameState,
  applyAction,
  type GameAction,
  type NewGamePlayer,
} from "./actions";
import {
  applyPlayerAction,
  advanceAuthority,
  redactState,
  HIDDEN_CARD,
} from "./authority";
import { isAlive, type GameState } from "./engine";

// mulberry32 — tiny deterministic PRNG so any failure reproduces from the seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seats(rand: () => number): NewGamePlayer[] {
  const humans = 1 + Math.floor(rand() * 4); // 1..4
  const ai = Math.floor(rand() * 3); // 0..2
  const total = Math.max(2, humans + ai);
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isAI: i >= humans,
    avatarKey: "ranger",
    ...(i >= humans
      ? {
          traits: {
            bluff: 1 + Math.floor(rand() * 5),
            memory: 1 + Math.floor(rand() * 5),
            patience: 1 + Math.floor(rand() * 5),
            aggression: 1 + Math.floor(rand() * 5),
            risk: 1 + Math.floor(rand() * 5),
          },
        }
      : {}),
  }));
}

const cardCount = (s: GameState) =>
  s.deck.length +
  s.discard.length +
  s.players.reduce((n, p) => n + p.hand.length, 0);
const allHidden = (hand: { id: string }[]) =>
  hand.every((c) => c.id === HIDDEN_CARD.id);

/** Assert redactState leaks nothing for a given viewer of the real state. */
function assertNoLeak(real: GameState, viewer: number | null) {
  const seatId = viewer === null ? null : real.players[viewer].id;
  const v = redactState(real, seatId);
  const revealed = real.phase === "dealEnd" || real.phase === "gameOver";

  // Conservation holds in every redacted view.
  expect(cardCount(v)).toBe(52);
  // The deck is never revealed.
  expect(allHidden(v.deck)).toBe(true);
  // The discard pile is public.
  expect(v.discard.map((c) => c.id)).toEqual(real.discard.map((c) => c.id));

  for (let p = 0; p < real.players.length; p++) {
    const view = v.players[p].hand;
    const truth = real.players[p].hand;
    expect(view.length).toBe(truth.length); // count always preserved
    if (revealed || p === viewer) {
      // Your own hand (any time) and everyone's at reveal are the real cards.
      expect(view.map((c) => c.id)).toEqual(truth.map((c) => c.id));
    } else {
      // Every other seat (and ALL seats for a null spectator) is fully hidden.
      expect(allHidden(view)).toBe(true);
    }
  }
}

function checkAllViews(real: GameState) {
  for (let viewer = 0; viewer < real.players.length; viewer++)
    assertNoLeak(real, viewer);
  assertNoLeak(real, null); // spectator
}

describe("redactState never leaks (fuzz)", () => {
  it("holds across thousands of randomly-driven states and every viewpoint", () => {
    let states = 0;
    for (let trial = 0; trial < 60; trial++) {
      const rand = rng(0x31_9a_c0 + trial);
      const opts = {
        threeOfAKind: rand() < 0.5,
        grace: rand() < 0.5,
        knockPenalty: rand() < 0.5,
        sound: false,
      };
      let state = advanceAuthority(
        applyAction(createGameState(seats(rand), opts), { type: "deal" }),
      );
      let steps = 0;
      while (state.phase !== "gameOver" && steps++ < 400) {
        checkAllViews(state);
        states++;
        if (state.phase === "dealEnd") {
          const alive = state.players.findIndex(isAlive);
          state = applyPlayerAction(
            state,
            state.players[alive >= 0 ? alive : 0].id,
            {
              type: "nextDeal",
            },
          );
          continue;
        }
        const cur = state.cur;
        const seatId = state.players[cur].id;
        let action: GameAction;
        if (state.phase === "drawing") {
          action =
            state.knocker === null && rand() < 0.3
              ? { type: "knock" }
              : { type: "drawDeck" };
        } else {
          const hand = state.players[cur].hand;
          action = {
            type: "discard",
            cardId: hand[Math.floor(rand() * hand.length)].id,
          };
        }
        state = applyPlayerAction(state, seatId, action);
      }
      checkAllViews(state); // final (gameOver or step-capped) state
      states++;
    }
    expect(states).toBeGreaterThan(1000); // genuinely exercised many states
  }, 30_000);
});
