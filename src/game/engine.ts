/**
 * 31 game engine — pure, framework-agnostic logic. No React, no DOM. The same
 * rules run client-side (local play) and server-side (the Supabase Edge
 * Function authority), which is what keeps online play tamper-resistant.
 */
import type { CardModel, Rank, Suit } from "../types";
import { cardValue } from "../types";

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** 1–5 behavioral traits that define an AI character's play. */
export interface AITraits {
  bluff: number;
  memory: number;
  patience: number;
  aggression: number;
  risk: number;
}

export const DEFAULT_TRAITS: AITraits = {
  bluff: 2,
  memory: 3,
  patience: 3,
  aggression: 3,
  risk: 3,
};

export interface GameOptions {
  /** Three of a kind scores 30½ (beats everything except 31). */
  threeOfAKind: boolean;
  /** Losing your last token grants one more deal on "Grace". */
  grace: boolean;
  /** A knocker who ends up lowest loses two tokens instead of one. */
  knockPenalty: boolean;
  sound: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  threeOfAKind: false,
  grace: true,
  knockPenalty: false,
  sound: true,
};

export interface GamePlayer {
  id: string;
  name: string;
  isAI: boolean;
  /** AI behavior profile (undefined for humans). */
  traits?: AITraits;
  /** Optional emoji avatar (AI characters); humans use avatarKey + SVG art. */
  emoji?: string;
  /** Optional portrait image URL (AI characters); preferred over emoji. */
  image?: string;
  avatarKey: string;
  /** Tokens remaining. Lose your last one (without Grace) and you're out. */
  tokens: number;
  grace: boolean;
  hand: CardModel[];
}

export type Phase =
  | "dealing"
  | "cover" // pass-the-device screen between human turns
  | "drawing" // current player chooses deck / discard / knock
  | "discarding" // current player has 4 cards, must discard one
  | "thinking" // an AI is taking its turn
  | "dealEnd"
  | "gameOver";

export interface GameState {
  players: GamePlayer[];
  deck: CardModel[];
  discard: CardModel[];
  cur: number;
  /** Seat that opens the current deal; rotates each deal for fairness. */
  dealer: number;
  knocker: number | null;
  /** Remaining seats to play after a knock. */
  queue: number[];
  phase: Phase;
  /** Hand index the current human has tapped to discard, or null. */
  selected: number | null;
  options: GameOptions;
  /** Which deal of the game (deal → knock → score → token loss). */
  dealNum: number;
  /** Turns begun in the current deal (used to derive the round/lap number). */
  turnInDeal: number;
  /** Players dealt in this deal (constant within a deal) — rounds = turns / this. */
  dealPlayers: number;
  status: string;
  /** Populated at deal end for the reveal overlay. */
  result: DealResult | null;
  /** Each completed deal's per-player hand score, for the end-game chart. */
  scoreHistory: DealScores[];
  /** Public action log for the current deal (most recent last). */
  log: LogEntry[];
  winnerId: string | null;
}

/** A publicly-visible action — what everyone would see at a real table. */
export interface LogEntry {
  id: number;
  actor: string;
  /** deck = drew a hidden card; takeDiscard / discard reveal the card. */
  kind: "deck" | "takeDiscard" | "discard" | "knock";
  card: CardModel | null;
}

export interface DealScores {
  deal: number;
  /** Number of rounds (laps of the table) played in this deal. */
  rounds: number;
  /** playerId → that deal's hand score. */
  scores: Record<string, number>;
  /** Who knocked that deal (null on an instant 31 / no knock). */
  knockerId: string | null;
}

export interface DealResult {
  title: string;
  /** Per-player snapshot, in seat order. */
  rows: {
    playerId: string;
    score: number;
    isLoser: boolean;
    livesLost: number;
    outcome: DamageOutcome | null;
  }[];
}

export type DamageOutcome = "lost" | "grace" | "eliminated";

/* ── Cards & scoring ────────────────────────────────────────────────────── */

/**
 * Unbiased random integer in [0, n) from the platform CSPRNG. Used for the
 * deck shuffle: on the server authority the deck order must not be predictable,
 * so we draw from crypto (available in browsers, Deno, and Node 18+) rather
 * than the predictable `Math.random`. Rejection sampling avoids modulo bias.
 */
function randomInt(n: number): number {
  const limit = Math.floor(0xffffffff / n) * n;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeDeck(): CardModel[] {
  const d: CardModel[] = [];
  for (const s of SUITS)
    for (const r of RANKS) d.push({ id: `${r}-${s}`, rank: r, suit: s });
  return shuffle(d);
}

/** Best single-suit total (or 30½ for three of a kind when enabled). */
export function scoreHand(hand: CardModel[], opts: GameOptions): number {
  if (hand.length === 0) return 0;
  if (
    opts.threeOfAKind &&
    hand.length === 3 &&
    hand[0].rank === hand[1].rank &&
    hand[1].rank === hand[2].rank
  )
    return 30.5;
  let best = 0;
  for (const suit of SUITS) {
    const t = hand
      .filter((c) => c.suit === suit)
      .reduce((n, c) => n + cardValue(c.rank), 0);
    if (t > best) best = t;
  }
  return best;
}

export function formatScore(s: number): string {
  return s === 30.5 ? "30½" : String(s);
}

/** The suit currently contributing the player's score (for highlighting). */
export function bestSuit(hand: CardModel[]): Suit | null {
  let best = 0;
  let suit: Suit | null = null;
  for (const s of SUITS) {
    const t = hand
      .filter((c) => c.suit === s)
      .reduce((n, c) => n + cardValue(c.rank), 0);
    if (t > best) {
      best = t;
      suit = s;
    }
  }
  return suit;
}

/* ── Player helpers ─────────────────────────────────────────────────────── */

export function isAlive(p: GamePlayer): boolean {
  return p.tokens > 0 || p.grace;
}
export function isEliminated(p: GamePlayer): boolean {
  return !isAlive(p);
}

/** Apply token loss; returns the outcome. Mutates the player (engine-local). */
export function takeDamage(
  player: GamePlayer,
  amount: number,
  opts: GameOptions,
): DamageOutcome {
  const hadTokens = player.tokens;
  player.tokens = Math.max(0, player.tokens - amount);
  if (player.tokens === 0) {
    const overflow = amount - hadTokens;
    if (opts.grace && !player.grace && overflow <= 0) {
      player.grace = true;
      return "grace";
    }
    player.grace = false;
    return "eliminated";
  }
  return "lost";
}

/* ── AI ─────────────────────────────────────────────────────────────────── */

export type AIPlan =
  | { kind: "knock" }
  | { kind: "takeDiscard"; handIndex: number }
  | { kind: "drawDeck" };

/* ── Trait → behavior mappings ──
   These translate a character's 1–5 traits into concrete decisions. */

/**
 * Score an AI holds out for before knocking. Patient builders AND greedy
 * chasers both wait for a strong hand, so the target is driven by whichever of
 * patience/risk is higher (with a small bonus for the other). Aggression does
 * not lower it — impulsive early knocks come from the bluff path instead, which
 * keeps high-risk chasers (Hank, Summit) holding out for 31 unless they also
 * bluff heavily (Coyote).
 */
export function aiKnockTarget(t: AITraits): number {
  const drive = Math.max(t.patience, t.risk);
  const minor = Math.min(t.patience, t.risk);
  return Math.max(18, Math.min(29, Math.round(16 + drive * 2.0 + minor * 0.4)));
}
/** Chance per turn to knock on a sub-target hand (a bluff). */
export function aiBluffChance(t: AITraits): number {
  return t.bluff * 0.05;
}
/** Chance to make a sub-optimal discard (low memory = sloppier play). */
export function aiPlayRandomChance(t: AITraits): number {
  return (5 - t.memory) * 0.06;
}
/** Whether the AI grabs a high discard even for a lateral move. */
export function aiGrabsHighDiscard(t: AITraits): boolean {
  return t.aggression >= 4 || t.risk >= 4;
}

/** Decide an AI's action for the draw phase (before any deck draw). */
export function planAITurn(state: GameState): AIPlan {
  const p = state.players[state.cur];
  const t = p.traits ?? DEFAULT_TRAITS;
  const hand = p.hand;
  const sc = scoreHand(hand, state.options);
  const top = state.discard[state.discard.length - 1] ?? null;

  // Desperation/clutch: on the last token, play more aggressively.
  const desperate = !p.grace && p.tokens === 1;
  const knockAt = aiKnockTarget(t) - (desperate ? 2 : 0);
  const bluffChance = aiBluffChance(t) + (desperate ? 0.12 : 0);

  if (state.knocker === null) {
    if (sc >= knockAt) return { kind: "knock" };
    // Bluff = knock a little BELOW your target to pressure the table — but never
    // on a genuinely weak hand. How far below scales with the bluff trait, and a
    // hard floor keeps "by-the-book" players (low bluff) from dumping junk hands.
    const bluffFloor = 17;
    const relaxedTarget = Math.max(bluffFloor, knockAt - t.bluff * 2);
    if (sc >= relaxedTarget && Math.random() < bluffChance) {
      return { kind: "knock" };
    }
  }

  const playRandom = Math.random() < aiPlayRandomChance(t);

  // Best swap using the top discard.
  let bestImprove = sc;
  let bestSwapIdx = -1;
  if (top && !playRandom) {
    for (let i = 0; i < hand.length; i++) {
      const test = [...hand];
      test[i] = top;
      const ts = scoreHand(test, state.options);
      if (ts > bestImprove) {
        bestImprove = ts;
        bestSwapIdx = i;
      }
    }
  }

  // Aggressive / high-risk players grab a high discard even for a lateral move.
  if (aiGrabsHighDiscard(t) && top && bestSwapIdx < 0) {
    if (cardValue(top.rank) >= 10) {
      for (let i = 0; i < hand.length; i++) {
        const test = [...hand];
        test[i] = top;
        if (scoreHand(test, state.options) >= sc) {
          bestSwapIdx = i;
          break;
        }
      }
    }
  }

  if (bestSwapIdx >= 0) return { kind: "takeDiscard", handIndex: bestSwapIdx };
  return { kind: "drawDeck" };
}

/** After an AI draws from the deck, choose which card to discard. */
export function aiDiscardIndex(
  hand: CardModel[],
  opts: GameOptions,
  playRandom: boolean,
): number {
  if (playRandom) return Math.floor(Math.random() * hand.length);
  let worst = 0;
  let bestRem = -1;
  for (let i = 0; i < hand.length; i++) {
    const rem = hand.filter((_, j) => j !== i);
    const rs = scoreHand(rem, opts);
    if (rs > bestRem) {
      bestRem = rs;
      worst = i;
    }
  }
  return worst;
}
