/**
 * Online multiplayer integration tests.
 *
 * These drive the same pure pieces the Edge Function authority uses — but from
 * MULTIPLE seats at once — to lock down the properties that matter across the
 * network: no seat ever sees another's cards, every seat agrees on the public
 * state, turn order is correct, and a full game played only via per-seat actions
 * always terminates. No Supabase needed; it's the authority logic end to end.
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
import {
  DEFAULT_OPTIONS,
  isAlive,
  type AITraits,
  type GameState,
} from "./engine";

const rnd = (n: number) => Math.floor(Math.random() * n);
const traits = (): AITraits => ({
  bluff: 1 + rnd(5),
  memory: 1 + rnd(5),
  patience: 1 + rnd(5),
  aggression: 1 + rnd(5),
  risk: 1 + rnd(5),
});

const seats = (humans: number, ai: number): NewGamePlayer[] => [
  ...Array.from({ length: humans }, (_, i) => ({
    id: `p${i}`,
    name: `Human${i}`,
    isAI: false,
    avatarKey: "ranger",
  })),
  ...Array.from({ length: ai }, (_, j) => ({
    id: `p${humans + j}`,
    name: `AI${j}`,
    isAI: true,
    avatarKey: "ranger",
    traits: traits(),
  })),
];

const cardCount = (s: GameState) =>
  s.deck.length +
  s.discard.length +
  s.players.reduce((n, p) => n + p.hand.length, 0);

const hidden = (hand: { id: string }[]) =>
  hand.every((c) => c.id === HIDDEN_CARD.id);

/**
 * A stand-in for the server: holds the one authoritative state, applies per-seat
 * actions (validating turn ownership + auto-running AI, exactly like the Edge
 * Function), and hands out each seat's redacted view.
 */
class Server {
  state: GameState;
  constructor(players: NewGamePlayer[], options = DEFAULT_OPTIONS) {
    // Mirror the Edge Function's "start": deal, then settle AI turns.
    this.state = advanceAuthority(
      applyAction(createGameState(players, options), { type: "deal" }),
    );
  }
  /** What seat `i` is allowed to see (what the wire would carry to that client). */
  view(i: number): GameState {
    return redactState(this.state, this.state.players[i].id);
  }
  /** Submit an action as seat `i`; returns whether it changed anything. */
  act(i: number, action: GameAction): boolean {
    const seatId = this.state.players[i].id;
    const next = applyPlayerAction(this.state, seatId, action);
    const applied = next !== this.state;
    this.state = next;
    return applied;
  }
}

describe("online multiplayer integration", () => {
  it("never leaks another seat's cards or the deck, mid-deal", () => {
    const server = new Server(seats(3, 2));
    expect(["drawing", "discarding"]).toContain(server.state.phase);

    for (let viewer = 0; viewer < 5; viewer++) {
      const v = server.view(viewer);
      const realHand = server.state.players[viewer].hand.map((c) => c.id);
      // Your own hand is real.
      expect(v.players[viewer].hand.map((c) => c.id)).toEqual(realHand);
      // Everyone else's hand is hidden, but the count is preserved.
      for (let other = 0; other < 5; other++) {
        if (other === viewer) continue;
        expect(hidden(v.players[other].hand)).toBe(true);
        expect(v.players[other].hand.length).toBe(
          server.state.players[other].hand.length,
        );
      }
      // The deck is never revealed; the discard pile is public.
      expect(hidden(v.deck)).toBe(true);
      expect(v.discard).toEqual(server.state.discard);
      // 52 cards still accounted for, even in the redacted view.
      expect(cardCount(v)).toBe(52);
    }
  });

  it("every seat agrees on the public state", () => {
    const server = new Server(seats(2, 2));
    const views = [0, 1, 2, 3].map((i) => server.view(i));
    const publicFacts = (v: GameState) => ({
      cur: v.cur,
      phase: v.phase,
      discard: v.discard.map((c) => c.id),
      deckLen: v.deck.length,
      tokens: v.players.map((p) => p.tokens),
      grace: v.players.map((p) => p.grace),
      log: v.log.map((e) => `${e.actor}:${e.kind}`),
    });
    const first = JSON.stringify(publicFacts(views[0]));
    for (const v of views.slice(1)) {
      expect(JSON.stringify(publicFacts(v))).toBe(first);
    }
  });

  it("reveals every hand to all seats at deal end", () => {
    // Two humans; drive to deal end by knocking on the first human's turn.
    const server = new Server(seats(2, 1));
    let guard = 0;
    while (server.state.phase !== "dealEnd" && guard++ < 200) {
      const s = server.state;
      const cur = s.cur;
      if (s.phase === "drawing") {
        // Knock once to start the showdown; afterwards the remaining seats take
        // their final turns (draw + discard) so the deal can actually resolve.
        if (s.knocker === null) {
          server.act(cur, { type: "knock" });
        } else {
          server.act(cur, { type: "drawDeck" });
          const d = server.state;
          if (d.phase === "discarding")
            server.act(d.cur, {
              type: "discard",
              cardId: d.players[d.cur].hand[0].id,
            });
        }
      } else {
        server.act(cur, {
          type: "discard",
          cardId: s.players[cur].hand[0].id,
        });
      }
    }
    expect(server.state.phase).toBe("dealEnd");
    for (let viewer = 0; viewer < 3; viewer++) {
      const v = server.view(viewer);
      for (let p = 0; p < 3; p++) {
        expect(v.players[p].hand.map((c) => c.id)).toEqual(
          server.state.players[p].hand.map((c) => c.id),
        );
      }
    }
  });

  it("rejects actions from a seat that isn't the current player", () => {
    const server = new Server(seats(2, 0));
    const cur = server.state.cur;
    const other = (cur + 1) % 2;
    expect(server.act(other, { type: "drawDeck" })).toBe(false); // not your turn
    expect(server.act(cur, { type: "drawDeck" })).toBe(true); // your turn
  });

  it("plays full games to completion via per-seat actions only", () => {
    for (let g = 0; g < 60; g++) {
      const humans = 1 + rnd(3); // 1–3 humans
      const ai = rnd(3); // 0–2 AI
      const total = humans + ai;
      if (total < 2) continue;
      const options = {
        threeOfAKind: Math.random() < 0.5,
        grace: Math.random() < 0.5,
        knockPenalty: Math.random() < 0.5,
        sound: false,
        showLog: true,
      };
      const server = new Server(seats(humans, ai), options);
      let steps = 0;
      while (server.state.phase !== "gameOver" && steps++ < 5000) {
        // Authority always rests on a human turn, deal end, or game over.
        expect(cardCount(server.state)).toBe(52);
        const s = server.state;
        if (s.phase === "dealEnd") {
          const alive = s.players.findIndex(isAlive);
          server.act(alive >= 0 ? alive : 0, { type: "nextDeal" });
          continue;
        }
        // It must be a human's turn here (AI are auto-run by the authority).
        expect(s.players[s.cur].isAI).toBe(false);
        const cur = s.cur;
        if (s.phase === "drawing") {
          if (s.knocker === null && Math.random() < 0.3) {
            server.act(cur, { type: "knock" });
          } else {
            server.act(cur, { type: "drawDeck" });
            if (server.state.phase === "discarding") {
              const h = server.state.players[server.state.cur].hand;
              server.act(server.state.cur, {
                type: "discard",
                cardId: h[rnd(h.length)].id,
              });
            }
          }
        } else {
          const h = s.players[cur].hand;
          server.act(cur, { type: "discard", cardId: h[rnd(h.length)].id });
        }
      }
      expect(server.state.phase).toBe("gameOver");
      const aliveAtEnd = server.state.players.filter(isAlive).length;
      expect(aliveAtEnd).toBeLessThanOrEqual(1);
      expect(Boolean(server.state.winnerId)).toBe(aliveAtEnd === 1);
    }
  });
});
