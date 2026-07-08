import { describe, it, expect } from "vitest";
import {
  createGameState,
  applyAction,
  dealtBlitzIndex,
  seatHumanPlayer,
  fillSeatsWithAI,
  type NewGamePlayer,
} from "./actions";
import {
  DEFAULT_OPTIONS,
  RANKS,
  SUITS,
  isAlive,
  type AITraits,
  type GamePlayer,
  type GameState,
} from "./engine";
import type { CardModel, Rank, Suit } from "../types";
import { FUZZ_SCALE, FUZZ_SEED, mulberry32 } from "./fuzzRig";

// Seeded stream (per-file constant XOR the run seed) so failures reproduce:
// FUZZ_SEED=<seed from the log> npm test — see fuzzRig.ts.
const rand = mulberry32(FUZZ_SEED ^ 0x0ac710e5);
const rnd = (n: number) => Math.floor(rand() * n);
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
    s = applyAction(s, { type: "discard", cardId: s.players[cur]!.hand[0]!.id });
    // Every log entry's actorSeat points at the player whose name it recorded.
    for (const e of s.log) {
      expect(e.actorSeat).toBeTypeOf("number");
      expect(s.players[e.actorSeat]!.name).toBe(e.actor);
    }
    // The moves we just made were the first player's, at their seat.
    expect(s.log.every((e) => e.actorSeat === cur)).toBe(true);
  });
});

describe("lobby seat transitions (join / start helpers)", () => {
  it("seatHumanPlayer converts an AI seat to a human, clearing AI-only fields", () => {
    const s0 = createGameState(aiPlayers(3), DEFAULT_OPTIONS);
    expect(s0.players[1]!.isAI).toBe(true);
    expect(s0.players[1]!.traits).toBeDefined();

    const s1 = seatHumanPlayer(s0, 1, "Randy");
    // New player is a human with no AI residue.
    expect(s1.players[1]!.isAI).toBe(false);
    expect(s1.players[1]!.name).toBe("Randy");
    expect(s1.players[1]!.avatarKey).toBe("ranger");
    expect(s1.players[1]!.traits).toBeUndefined();
    expect(s1.players[1]!.emoji).toBeUndefined();
    // Pure: the input is untouched, and other seats are unchanged.
    expect(s0.players[1]!.isAI).toBe(true);
    expect(s1.players[0]).toEqual(s0.players[0]);
    expect(s1.players[2]).toEqual(s0.players[2]);
  });

  it("fillSeatsWithAI flips only the named seats to AI, immutably", () => {
    // Seat two humans, then fill seats 1 and 2 with AI (as start does).
    let s = createGameState(aiPlayers(3), DEFAULT_OPTIONS);
    s = seatHumanPlayer(s, 1, "Human A");
    s = seatHumanPlayer(s, 2, "Human B");
    const filled = fillSeatsWithAI(s, [2]);
    expect(filled.players[1]!.isAI).toBe(false); // untouched
    expect(filled.players[2]!.isAI).toBe(true); // converted
    expect(s.players[2]!.isAI).toBe(false); // input untouched
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
    expect(after.players[after.cur]!.hand.length).toBe(4);
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
    drew.players[cur]!.hand = [
      { id: "2-clubs", rank: "2", suit: "clubs" },
      { id: "3-clubs", rank: "3", suit: "clubs" },
      { id: "4-diamonds", rank: "4", suit: "diamonds" },
      { id: "5-spades", rank: "5", suit: "spades" },
    ];
    const discarded = applyAction(drew, {
      type: "discard",
      cardId: drew.players[cur]!.hand[0]!.id,
    });
    expect(discarded.players[cur]!.hand.length).toBe(3);
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
    let s = createGameState(aiPlayers(3), DEFAULT_OPTIONS);
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
  it(
    "conserves 52 cards, eliminates cleanly, and ends with exactly one winner",
    () => {
      for (let g = 0; g < 150 * FUZZ_SCALE; g++) {
        const n = 2 + rnd(5); // 2–6 players
        const options = {
          threeOfAKind: rand() < 0.5,
          grace: rand() < 0.5,
          knockPenalty: rand() < 0.5,
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
              if (s.knocker === null && rand() < 0.25) {
                s = applyAction(s, { type: "knock" });
              } else {
                s = applyAction(s, rand() < 0.5 ? { type: "drawDeck" } : { type: "takeDiscard" });
                if (s.phase === "discarding") {
                  const h = s.players[s.cur]!.hand;
                  s = applyAction(s, {
                    type: "discard",
                    cardId: h[rnd(h.length)]!.id,
                  });
                }
              }
            } else {
              const h = s.players[s.cur]!.hand;
              s = applyAction(s, {
                type: "discard",
                cardId: h[rnd(h.length)]!.id,
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
    },
    30_000 * FUZZ_SCALE,
  );
});

/* ── Mutation-audit pins ─────────────────────────────────────────────────────
 * See the note in engine.test.ts: these kill real Stryker survivors — a deck
 * built from a corrupted rank list, and the knock-penalty resolution rule.
 */

describe("deck composition (mutation-audit pin)", () => {
  it("a fresh deal holds exactly the 52 canonical rank x suit cards", () => {
    // Pin the canonical lists as literals FIRST — the loop below iterates
    // RANKS/SUITS itself, so a mutated list would otherwise self-consistently
    // pass its own composition check.
    expect(RANKS).toEqual(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
    expect(SUITS).toEqual(["spades", "hearts", "diamonds", "clubs"]);
    const s = applyAction(createGameState(aiPlayers(3), DEFAULT_OPTIONS), { type: "deal" });
    const all = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand)];
    expect(all).toHaveLength(52);
    const combos = new Set(all.map((card) => `${card.rank}|${card.suit}`));
    expect(combos.size).toBe(52); // no duplicates
    for (const rank of RANKS)
      for (const suit of SUITS)
        expect(combos.has(`${rank}|${suit}`), `missing ${rank} of ${suit}`).toBe(true);
  });
});

describe("knock-penalty resolution (mutation-audit pin)", () => {
  // Deterministic showdown between a 10-point hand (seat 0) and a 30-point
  // hand (30, not 31 — an exact 31 would fire the instant-blitz path, where
  // the knock penalty correctly never applies). Hands are planted after the
  // deal with unique ids so they can't collide with deck cards; phase/tokens
  // are reset in case the random deal resolved itself (blitz).
  const fx = (i: number, rank: Rank, suit: Suit): CardModel => ({ id: `fx${i}`, rank, suit });
  const playShowdown = (knockPenalty: boolean, knockerSeat: 0 | 1): GameState => {
    const humans = [0, 1].map((i) => ({
      id: `p${i}`,
      name: `H${i}`,
      isAI: false,
      avatarKey: "ranger",
    }));
    const s = applyAction(createGameState(humans, { ...DEFAULT_OPTIONS, knockPenalty }), {
      type: "deal",
    });
    s.players[0]!.hand = [fx(0, "2", "hearts"), fx(1, "3", "clubs"), fx(2, "5", "spades")];
    s.players[1]!.hand = [fx(3, "K", "spades"), fx(4, "Q", "spades"), fx(5, "J", "spades")];
    for (const p of s.players) {
      p.tokens = 3;
      p.grace = false;
    }
    s.phase = "drawing";
    s.knocker = null;
    s.queue = [];
    s.cur = knockerSeat;

    let next = applyAction(s, { type: "knock" });
    expect(next.cur).toBe(1 - knockerSeat);
    next = applyAction(next, { type: "drawDeck" }); // the other seat takes the final turn...
    const drawn = next.players[1 - knockerSeat]!.hand[3]!;
    next = applyAction(next, { type: "discard", cardId: drawn.id }); // ...and stands pat
    expect(next.phase).toBe("dealEnd"); // queue drained -> showdown resolved
    return next;
  };
  const rowOf = (s: GameState, id: string) =>
    s.result!.rows.find((r: { playerId: string }) => r.playerId === id)!;

  it("the knocker who loses the showdown pays double with the penalty on", () => {
    const s = playShowdown(true, 0); // seat 0 knocks on the weakest hand
    expect(s.players[0]!.tokens).toBe(1); // 3 - 2
    expect(s.players[1]!.tokens).toBe(3); // winner untouched
    expect(rowOf(s, "p0").isLoser).toBe(true); // the scorecard marks the loser...
    expect(rowOf(s, "p1").isLoser).toBe(false); // ...and only the loser
  });
  it("...and the normal single token with the penalty off", () => {
    const s = playShowdown(false, 0);
    expect(s.players[0]!.tokens).toBe(2); // 3 - 1
    expect(s.players[1]!.tokens).toBe(3);
  });
  it("a LOSER who didn't knock never pays double, even with the penalty on", () => {
    const s = playShowdown(true, 1); // seat 1 knocks holding the strong hand
    expect(s.players[0]!.tokens).toBe(2); // lowest hand, but not the knocker: 3 - 1
    expect(s.players[1]!.tokens).toBe(3);
    expect(rowOf(s, "p0").isLoser).toBe(true);
  });
});
