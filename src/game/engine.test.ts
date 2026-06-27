import { describe, it, expect } from "vitest";
import type { CardModel, Rank, Suit } from "../types";
import { cardValue } from "../types";
import {
  DEFAULT_OPTIONS,
  scoreHand,
  bestSuit,
  takeDamage,
  isAlive,
  isEliminated,
  aiKnockTarget,
  aiBluffChance,
  aiPlayRandomChance,
  type GameOptions,
  type GamePlayer,
} from "./engine";
import { AI_CHARACTERS, CHARACTERS_BY_ID } from "./aiCharacters";

const c = (rank: Rank, suit: Suit): CardModel => ({
  id: `${rank}-${suit}`,
  rank,
  suit,
});
const opts = (o: Partial<GameOptions> = {}): GameOptions => ({
  ...DEFAULT_OPTIONS,
  ...o,
});
const player = (over: Partial<GamePlayer> = {}): GamePlayer => ({
  id: "p",
  name: "P",
  isAI: false,
  avatarKey: "ranger",
  lives: 3,
  grace: false,
  hand: [],
  ...over,
});

describe("cardValue", () => {
  it("scores Ace 11, faces 10, pips at face value", () => {
    expect(cardValue("A")).toBe(11);
    expect(cardValue("K")).toBe(10);
    expect(cardValue("Q")).toBe(10);
    expect(cardValue("J")).toBe(10);
    expect(cardValue("10")).toBe(10);
    expect(cardValue("7")).toBe(7);
    expect(cardValue("2")).toBe(2);
  });
});

describe("scoreHand", () => {
  it("sums only same-suit cards", () => {
    expect(
      scoreHand([c("A", "spades"), c("K", "spades"), c("8", "spades")], opts()),
    ).toBe(29);
  });
  it("takes the best single suit from a mixed hand", () => {
    // A♠ alone (11) vs K♥+8♦ split — best single suit is the Ace's 11.
    expect(
      scoreHand(
        [c("A", "spades"), c("K", "hearts"), c("8", "diamonds")],
        opts(),
      ),
    ).toBe(11);
  });
  it("reaches a perfect 31 with Ace + two tens of one suit", () => {
    expect(
      scoreHand(
        [c("A", "hearts"), c("K", "hearts"), c("10", "hearts")],
        opts(),
      ),
    ).toBe(31);
  });
  it("scores three of a kind as 30.5 only when the rule is on", () => {
    const trips = [c("7", "spades"), c("7", "hearts"), c("7", "clubs")];
    expect(scoreHand(trips, opts({ threeOfAKind: true }))).toBe(30.5);
    expect(scoreHand(trips, opts({ threeOfAKind: false }))).toBe(7);
  });
  it("scores an empty hand as 0", () => {
    expect(scoreHand([], opts())).toBe(0);
  });
});

describe("bestSuit", () => {
  it("returns the suit contributing the score", () => {
    expect(
      bestSuit([c("A", "spades"), c("K", "spades"), c("2", "hearts")]),
    ).toBe("spades");
  });
});

describe("takeDamage", () => {
  it("loses a token without elimination when tokens remain", () => {
    const p = player({ lives: 3 });
    expect(takeDamage(p, 1, opts())).toBe("lost");
    expect(p.lives).toBe(2);
  });
  it("grants Grace when the last token is lost (grace on)", () => {
    const p = player({ lives: 1 });
    expect(takeDamage(p, 1, opts({ grace: true }))).toBe("grace");
    expect(p.lives).toBe(0);
    expect(p.grace).toBe(true);
  });
  it("eliminates a player already on Grace", () => {
    const p = player({ lives: 0, grace: true });
    expect(takeDamage(p, 1, opts({ grace: true }))).toBe("eliminated");
    expect(p.grace).toBe(false);
  });
  it("eliminates immediately when grace is off", () => {
    const p = player({ lives: 1 });
    expect(takeDamage(p, 1, opts({ grace: false }))).toBe("eliminated");
  });
  it("punches through Grace when overflow damage exceeds tokens", () => {
    // Knock penalty: losing 2 with only 1 token does NOT grant grace.
    const p = player({ lives: 1 });
    expect(takeDamage(p, 2, opts({ grace: true }))).toBe("eliminated");
  });
});

describe("isAlive / isEliminated", () => {
  it("treats grace players as alive", () => {
    expect(isAlive(player({ lives: 0, grace: true }))).toBe(true);
    expect(isEliminated(player({ lives: 0, grace: false }))).toBe(true);
    expect(isAlive(player({ lives: 1 }))).toBe(true);
  });
});

describe("AI trait → behaviour mappings", () => {
  it("keeps every character's knock target in a sane band", () => {
    for (const ch of AI_CHARACTERS) {
      const t = aiKnockTarget(ch.traits);
      expect(t).toBeGreaterThanOrEqual(18);
      expect(t).toBeLessThanOrEqual(29);
    }
  });
  it("makes greedy chasers hold out for a strong hand", () => {
    expect(
      aiKnockTarget(CHARACTERS_BY_ID["half-dome-hank"].traits),
    ).toBeGreaterThanOrEqual(26);
    expect(
      aiKnockTarget(CHARACTERS_BY_ID["summit-sam"].traits),
    ).toBeGreaterThanOrEqual(26);
  });
  it("makes patient builders hold out too", () => {
    expect(
      aiKnockTarget(CHARACTERS_BY_ID["paula-pine"].traits),
    ).toBeGreaterThanOrEqual(26);
    expect(
      aiKnockTarget(CHARACTERS_BY_ID["bison-bill"].traits),
    ).toBeGreaterThanOrEqual(26);
  });
  it("scales bluff and sloppiness with their traits", () => {
    expect(
      aiBluffChance({
        bluff: 5,
        memory: 3,
        patience: 3,
        aggression: 3,
        risk: 3,
      }),
    ).toBeGreaterThan(
      aiBluffChance({
        bluff: 1,
        memory: 3,
        patience: 3,
        aggression: 3,
        risk: 3,
      }),
    );
    // Lower memory → more random (sloppier) discards.
    expect(
      aiPlayRandomChance({
        bluff: 2,
        memory: 1,
        patience: 3,
        aggression: 3,
        risk: 3,
      }),
    ).toBeGreaterThan(
      aiPlayRandomChance({
        bluff: 2,
        memory: 5,
        patience: 3,
        aggression: 3,
        risk: 3,
      }),
    );
  });
});
