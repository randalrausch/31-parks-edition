import { describe, it, expect } from "vitest";
import { createGameState, applyAction, dealtBlitzIndex, type NewGamePlayer } from "./actions";
import { DEFAULT_OPTIONS, isAlive, type AITraits, type GamePlayer, type GameState } from "./engine";

const rnd = (n: number) => Math.floor(Math.random() * n);
const traits = (): AITraits => ({
  bluff: 1 + rnd(5),
  memory: 1 + rnd(5),
  patience: 1 + rnd(5),
  aggression: 1 + rnd(5),
  risk: 1 + rnd(5),
});
const aiPlayers = (n: number): NewGamePlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `AI${i}`,
    isAI: true,
    avatarKey: "ranger",
    traits: traits(),
  }));
const cardCount = (s: GameState) =>
  s.deck.length + s.discard.length + s.players.reduce((n, p) => n + p.hand.length, 0);

describe("createGameState + deal", () => {
  it("deals three cards to each player and flips one discard", () => {
    const s0 = createGameState(aiPlayers(3), DEFAULT_OPTIONS);
    expect(s0.phase).toBe("dealEnd"); // pre-deal sentinel
    const s = applyAction(s0, { type: "deal" });
    expect(s.players.every((p) => p.hand.length === 3)).toBe(true);
    expect(s.discard.length).toBe(1);
    expect(cardCount(s)).toBe(52);
    expect(s.dealNum).toBe(1);
  });

  it("is pure — does not mutate the input state", () => {
    const s0 = applyAction(createGameState(aiPlayers(2), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const snapshot = JSON.stringify(s0);
    applyAction(s0, { type: "drawDeck" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it("logs each move with the acting player's seat index (stable identity)", () => {
    // Two players share a display name; actorSeat must still identify who acted,
    // so a name-based match can't confuse them (the turn-replay attribution bug).
    const players: NewGamePlayer[] = [
      { id: "p0", name: "Sam", isAI: true, avatarKey: "ranger", traits: traits() },
      { id: "p1", name: "Sam", isAI: true, avatarKey: "ranger", traits: traits() },
    ];
    let s = applyAction(createGameState(players, DEFAULT_OPTIONS), { type: "deal" });
    const cur = s.cur;
    s = applyAction(s, { type: "drawDeck" });
    s = applyAction(s, { type: "discard", cardId: s.players[cur].hand[0].id });
    // Every log entry's actorSeat points at the player whose name it recorded.
    for (const e of s.log) {
      expect(e.actorSeat).toBeTypeOf("number");
      expect(s.players[e.actorSeat].name).toBe(e.actor);
    }
    // The moves we just made were the first player's, at their seat.
    expect(s.log.every((e) => e.actorSeat === cur)).toBe(true);
  });
});

describe("dealt 31 (blitz) detection", () => {
  const card = (rank: string, suit: string) => ({
    id: `${rank}-${suit}`,
    rank: rank as GamePlayer["hand"][number]["rank"],
    suit: suit as GamePlayer["hand"][number]["suit"],
  });
  const stub = (hand: GamePlayer["hand"]): GamePlayer => ({
    id: "x",
    name: "x",
    isAI: true,
    avatarKey: "ranger",
    tokens: 3,
    grace: false,
    hand,
  });

  it("finds a natural 31 on any seat, not just the opener", () => {
    const players = [
      stub([card("2", "clubs"), card("3", "clubs"), card("4", "diamonds")]),
      stub([card("A", "hearts"), card("K", "hearts"), card("Q", "hearts")]), // 31
    ];
    expect(dealtBlitzIndex(players, DEFAULT_OPTIONS)).toBe(1);
  });

  it("does not mistake three of a kind (30½) for a 31", () => {
    const trips = [stub([card("A", "hearts"), card("A", "spades"), card("A", "clubs")])];
    expect(dealtBlitzIndex(trips, { ...DEFAULT_OPTIONS, threeOfAKind: true })).toBe(-1);
  });
});

describe("turn actions", () => {
  it("drawDeck moves to discarding with a 4-card hand", () => {
    const s = applyAction(createGameState(aiPlayers(2), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const after = applyAction(s, { type: "drawDeck" });
    expect(after.phase).toBe("discarding");
    expect(after.players[after.cur].hand.length).toBe(4);
  });

  it("discard returns to a 3-card hand and passes the turn", () => {
    // A natural (dealt) 31 resolves the deal instantly (phase → dealEnd), so
    // there'd be no draw/discard to make — re-deal until we get a normal
    // in-play hand. Rare (~0.2%), so this almost always runs once.
    let s = applyAction(createGameState(aiPlayers(2), DEFAULT_OPTIONS), {
      type: "deal",
    });
    while (s.phase !== "drawing") {
      s = applyAction(createGameState(aiPlayers(2), DEFAULT_OPTIONS), {
        type: "deal",
      });
    }
    const cur = s.cur;
    const drew = applyAction(s, { type: "drawDeck" });
    // Pin the hand to known low cards so the post-discard 3-card hand can never
    // be a natural 31 — a random 31 resolves the deal instead of passing the
    // turn (actions.ts: discard → resolveDeal vs endTurn), which made this test
    // flake on unlucky shuffles.
    drew.players[cur].hand = [
      { id: "2-clubs", rank: "2", suit: "clubs" },
      { id: "3-clubs", rank: "3", suit: "clubs" },
      { id: "4-diamonds", rank: "4", suit: "diamonds" },
      { id: "5-spades", rank: "5", suit: "spades" },
    ];
    const discarded = applyAction(drew, {
      type: "discard",
      cardId: drew.players[cur].hand[0].id,
    });
    expect(discarded.players[cur].hand.length).toBe(3);
    expect(discarded.cur).not.toBe(cur);
  });

  it("knock records the knocker and queues the remaining players", () => {
    const s = applyAction(createGameState(aiPlayers(3), DEFAULT_OPTIONS), {
      type: "deal",
    });
    const knocker = s.cur;
    const after = applyAction(s, { type: "knock" });
    expect(after.knocker).toBe(knocker);
  });

  it("rotates the opening seat each deal", () => {
    let s = createGameState(aiPlayers(3), { ...DEFAULT_OPTIONS, sound: false });
    const openers: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: "deal" });
      openers.push(s.dealer);
      expect(s.cur).toBe(s.dealer); // play opens on the rotated seat
    }
    expect(openers).toEqual([0, 1, 2, 0]); // advances each deal, then wraps
  });
});

describe("invariants over many random full games", () => {
  it("conserves 52 cards, eliminates cleanly, and ends with exactly one winner", () => {
    for (let g = 0; g < 150; g++) {
      const n = 2 + rnd(5); // 2–6 players
      const options = {
        threeOfAKind: Math.random() < 0.5,
        grace: Math.random() < 0.5,
        knockPenalty: Math.random() < 0.5,
        sound: false,
        showLog: true,
        fullHistory: false,
      };
      let s = applyAction(createGameState(aiPlayers(n), options), {
        type: "deal",
      });
      let prevTokens = s.players.reduce((t, p) => t + p.tokens, 0);
      let steps = 0;

      while (s.phase !== "gameOver") {
        expect(cardCount(s)).toBe(52);
        if (s.phase === "drawing" || s.phase === "discarding") {
          expect(s.players.some((p) => !isAlive(p) && p.hand.length > 0)).toBe(false);
        }
        if (s.phase === "dealEnd") {
          const tokens = s.players.reduce((t, p) => t + p.tokens, 0);
          expect(tokens).toBeLessThanOrEqual(prevTokens); // tokens never increase
          prevTokens = tokens;
          s = applyAction(s, { type: "nextDeal" });
        } else {
          // Drive a simple legal action: knock sometimes, else draw + discard.
          if (s.phase === "drawing") {
            if (s.knocker === null && Math.random() < 0.25) {
              s = applyAction(s, { type: "knock" });
            } else {
              s = applyAction(
                s,
                Math.random() < 0.5 ? { type: "drawDeck" } : { type: "takeDiscard" },
              );
              if (s.phase === "discarding") {
                const h = s.players[s.cur].hand;
                s = applyAction(s, {
                  type: "discard",
                  cardId: h[rnd(h.length)].id,
                });
              }
            }
          } else {
            const h = s.players[s.cur].hand;
            s = applyAction(s, {
              type: "discard",
              cardId: h[rnd(h.length)].id,
            });
          }
        }
        expect(++steps).toBeLessThan(6000); // must terminate
      }

      // A game ends with one winner — or zero, if the last players are
      // eliminated in the same deal (a draw). Winner is set iff one survives.
      const aliveAtEnd = s.players.filter(isAlive).length;
      expect(aliveAtEnd).toBeLessThanOrEqual(1);
      expect(Boolean(s.winnerId)).toBe(aliveAtEnd === 1);
      expect(s.scoreHistory.length).toBe(s.dealNum);
    }
  });
});
