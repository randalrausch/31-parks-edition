import { describe, it, expect } from "vitest";
import { createGameState, applyAction, type GameAction, type NewGamePlayer } from "./actions";
import { applyPlayerAction, advanceAuthority, redactState, HIDDEN_CARD } from "./authority";
import { DEFAULT_OPTIONS, isAlive, type AITraits, type GameState } from "./engine";

const rnd = (n: number) => Math.floor(Math.random() * n);
const traits = (): AITraits => ({
  bluff: 1 + rnd(5),
  memory: 1 + rnd(5),
  patience: 1 + rnd(5),
  aggression: 1 + rnd(5),
  risk: 1 + rnd(5),
});
const cardCount = (s: GameState) =>
  s.deck.length + s.discard.length + s.players.reduce((n, p) => n + p.hand.length, 0);
const hidden = (h: { id: string }[]) => h.every((c) => c.id === HIDDEN_CARD.id);

const mixed = (humanIds: string[], aiCount: number): NewGamePlayer[] => [
  ...humanIds.map((id, i) => ({
    id,
    name: `H${i}`,
    isAI: false,
    avatarKey: "ranger",
  })),
  ...Array.from({ length: aiCount }, (_, j) => ({
    id: `a${j}`,
    name: `A${j}`,
    isAI: true,
    avatarKey: "ranger",
    traits: traits(),
  })),
];

describe("redactState", () => {
  it("shows the viewer their own hand and hides everyone else + the deck", () => {
    const s = applyAction(createGameState(mixed(["h0"], 2), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const v = redactState(s, "h0");
    expect(v.players.find((p) => p.id === "h0")!.hand.map((c) => c.id)).toEqual(
      s.players[0].hand.map((c) => c.id),
    );
    expect(hidden(v.players.find((p) => p.id === "a0")!.hand)).toBe(true);
    expect(v.players.find((p) => p.id === "a0")!.hand.length).toBe(3); // count preserved
    expect(hidden(v.deck)).toBe(true);
    expect(v.deck.length).toBe(s.deck.length);
    expect(v.discard).toEqual(s.discard); // discard is public
  });

  it("hides all hands from a spectator mid-deal", () => {
    const s = applyAction(createGameState(mixed(["h0"], 2), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const v = redactState(s, null);
    expect(v.players.every((p) => hidden(p.hand))).toBe(true);
  });

  it("reveals every hand at deal end", () => {
    let s = applyAction(createGameState(mixed(["h0"], 1), DEFAULT_OPTIONS), {
      type: "deal",
    });
    let guard = 0;
    while (s.phase !== "dealEnd" && guard++ < 500) {
      s = s.players[s.cur].isAI
        ? advanceAuthority(s)
        : applyPlayerAction(s, s.players[s.cur].id, { type: "knock" });
    }
    expect(s.phase).toBe("dealEnd");
    const v = redactState(s, "h0");
    expect(
      v.players.every((p, i) => p.hand.every((c, j) => c.id === s.players[i].hand[j].id)),
    ).toBe(true);
  });
});

describe("applyPlayerAction (authority)", () => {
  it("rejects an action from a seat that isn't the current player", () => {
    const s = applyAction(createGameState(mixed(["h0", "h1"], 0), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const wrong = s.players[(s.cur + 1) % 2].id;
    expect(applyPlayerAction(s, wrong, { type: "drawDeck" })).toBe(s); // unchanged
  });

  it("applies an action from the correct seat", () => {
    const s = applyAction(createGameState(mixed(["h0", "h1"], 0), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const after = applyPlayerAction(s, s.players[s.cur].id, {
      type: "drawDeck",
    });
    expect(after.phase).toBe("discarding");
  });

  it("treats an out-of-phase action as a no-op (returns the same state ref)", () => {
    // In "drawing", a discard is the right seat + an allowed action type, but
    // wrong phase — the reducer no-ops it. Authority must collapse that back to
    // the original reference so the server can skip persisting/broadcasting.
    const s = applyAction(createGameState(mixed(["h0", "h1"], 0), DEFAULT_OPTIONS), {
      type: "deal",
    });
    expect(s.phase).toBe("drawing");
    const after = applyPlayerAction(s, s.players[s.cur].id, {
      type: "discard",
      cardId: "no-such-card",
    });
    expect(after).toBe(s);
  });

  it("rejects the server-internal 'deal' action (no mid-turn re-deal)", () => {
    const s = applyAction(createGameState(mixed(["h0", "h1"], 0), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const before = JSON.stringify(s);
    const after = applyPlayerAction(s, s.players[s.cur].id, {
      type: "deal",
    } as unknown as GameAction);
    expect(JSON.stringify(after)).toBe(before);
  });

  it("lets only the host (seat 0) toggle the shared log setting", () => {
    const s = applyAction(createGameState(mixed(["h0", "h1"], 0), DEFAULT_OPTIONS), {
      type: "deal",
    });
    expect(s.options.showLog).toBe(true);
    // A non-host attempt is a no-op (same reference, setting unchanged).
    const byOther = applyPlayerAction(s, "h1", {
      type: "setShowLog",
      value: false,
    });
    expect(byOther).toBe(s);
    // The host can hide it for the whole table, in any phase…
    const hidden = applyPlayerAction(s, "h0", {
      type: "setShowLog",
      value: false,
    });
    expect(hidden.options.showLog).toBe(false);
    // …and a redundant set collapses back to a no-op (nothing to broadcast).
    expect(applyPlayerAction(hidden, "h0", { type: "setShowLog", value: false })).toBe(hidden);
  });
});

describe("advanceAuthority", () => {
  it("auto-plays consecutive AI turns and rests on a human (or deal end)", () => {
    // Human in seat 1; seat 0 is AI → advancing should reach the human or dealEnd.
    const s = applyAction(
      createGameState(
        mixed([], 1).concat({
          id: "h",
          name: "H",
          isAI: false,
          avatarKey: "ranger",
        }),
        DEFAULT_OPTIONS,
      ),
      { type: "deal" },
    );
    const settled = advanceAuthority(s);
    const restsOnHuman = !settled.players[settled.cur].isAI;
    expect(restsOnHuman || settled.phase === "dealEnd" || settled.phase === "gameOver").toBe(true);
  });
});

describe("full async games (only human actions submitted)", () => {
  it("progress, conserve cards, and finish with one winner", () => {
    for (let g = 0; g < 80; g++) {
      const n = 2 + rnd(4);
      const humans = Math.max(1, rnd(n));
      const humanIds = Array.from({ length: humans }, (_, i) => `p${i}`);
      const players = [
        ...humanIds.map((id, i) => ({
          id,
          name: `H${i}`,
          isAI: false,
          avatarKey: "ranger",
        })),
        ...Array.from({ length: n - humans }, (_, j) => ({
          id: `p${humans + j}`,
          name: `A${j}`,
          isAI: true,
          avatarKey: "ranger",
          traits: traits(),
        })),
      ];
      const options = {
        threeOfAKind: Math.random() < 0.5,
        grace: Math.random() < 0.5,
        knockPenalty: Math.random() < 0.5,
        sound: false,
        showLog: true,
        fullHistory: false,
      };
      let s = advanceAuthority(applyAction(createGameState(players, options), { type: "deal" }));
      let steps = 0;
      while (s.phase !== "gameOver" && steps++ < 4000) {
        expect(cardCount(s)).toBe(52);
        if (s.phase === "dealEnd") {
          const h = s.players.find((p) => !p.isAI) ?? s.players[0];
          s = applyPlayerAction(s, h.id, { type: "nextDeal" });
          continue;
        }
        // Authority should always rest on a human turn here.
        expect(s.players[s.cur].isAI).toBe(false);
        const id = s.players[s.cur].id;
        if (s.phase === "drawing") {
          const act: GameAction = Math.random() < 0.3 ? { type: "knock" } : { type: "drawDeck" };
          const ns = applyPlayerAction(s, id, act);
          s = ns === s ? applyPlayerAction(s, id, { type: "drawDeck" }) : ns;
        } else {
          s = applyPlayerAction(s, id, {
            type: "discard",
            cardId: s.players[s.cur].hand[0].id,
          });
        }
      }
      expect(s.phase).toBe("gameOver");
      // One winner, or zero on a simultaneous final elimination (draw).
      expect(s.players.filter(isAlive).length).toBeLessThanOrEqual(1);
    }
  });
});
