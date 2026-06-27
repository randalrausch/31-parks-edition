/**
 * Authoritative game actions + a pure reducer.
 *
 * `applyAction(state, action)` is the single source of truth for how the game
 * state changes — no timing, no animation, no AI, no React. It's fully
 * serializable, so the exact same function can run in the browser (local play)
 * or in the Supabase Edge Function authority for networked multiplayer. Presentation
 * concerns (deal animation, "thinking" pauses, pass-the-device cover screens,
 * coin-sound staggering) live in the client layer that drives this.
 *
 * Authoritative phases used here: "drawing" (current player to draw/knock),
 * "discarding" (drew, must discard), "dealEnd", "gameOver". The presentation
 * phases ("dealing"/"cover"/"thinking") are never emitted by the reducer.
 */
import type { CardModel } from "../types";
import {
  type GameState,
  type GamePlayer,
  type DamageOutcome,
  type LogEntry,
  makeDeck,
  shuffle,
  scoreHand,
  isAlive,
  isEliminated,
  takeDamage,
} from "./engine";

export type GameAction =
  | { type: "deal" } // start the next deal (deal cards to all living players)
  | { type: "drawDeck" } // current player draws the top of the deck
  | { type: "takeDiscard" } // current player takes the face-up discard
  | { type: "discard"; cardId: string } // current player discards a card by id
  | { type: "knock" } // current player knocks
  | { type: "nextDeal" }; // advance from dealEnd → next deal or game over

/** Apply an action to a state, returning a new state. Pure (clones input). */
export function applyAction(state: GameState, action: GameAction): GameState {
  const s: GameState = structuredClone(state);
  switch (action.type) {
    case "deal":
      dealCards(s);
      return s;
    case "drawDeck":
      if (s.phase !== "drawing") return s;
      if (s.deck.length === 0) reshuffle(s);
      if (s.deck.length === 0) return s;
      s.players[s.cur].hand.push(s.deck.pop()!);
      log(s, "deck", null);
      s.phase = "discarding";
      return s;
    case "takeDiscard": {
      if (s.phase !== "drawing" || s.discard.length === 0) return s;
      const taken = s.discard.pop()!;
      s.players[s.cur].hand.push(taken);
      log(s, "takeDiscard", taken);
      s.phase = "discarding";
      return s;
    }
    case "discard": {
      if (s.phase !== "discarding") return s;
      const p = s.players[s.cur];
      const idx = p.hand.findIndex((c) => c.id === action.cardId);
      if (idx < 0) return s;
      const removed = p.hand.splice(idx, 1)[0];
      s.discard.push(removed);
      log(s, "discard", removed);
      s.phase = "drawing";
      if (scoreHand(p.hand, s.options) === 31) {
        resolveDeal(s, s.cur);
      } else {
        endTurn(s);
      }
      return s;
    }
    case "knock": {
      if (s.phase !== "drawing" || s.knocker !== null) return s;
      log(s, "knock", null);
      s.knocker = s.cur;
      s.queue = [];
      let i = (s.cur + 1) % s.players.length;
      while (i !== s.cur) {
        if (isAlive(s.players[i])) s.queue.push(i);
        i = (i + 1) % s.players.length;
      }
      if (s.queue.length === 0) {
        resolveDeal(s, null);
      } else {
        s.cur = s.queue.shift()!;
        s.turnInDeal += 1;
      }
      return s;
    }
    case "nextDeal": {
      if (s.phase !== "dealEnd") return s;
      const alive = s.players.filter(isAlive);
      if (alive.length <= 1) {
        s.winnerId = alive[0]?.id ?? null;
        s.phase = "gameOver";
      } else {
        dealCards(s);
      }
      return s;
    }
    default:
      return s;
  }
}

/* ── internal transitions ────────────────────────────────────────────────── */

function dealCards(s: GameState): void {
  s.dealNum += 1;
  s.turnInDeal = 1; // the first player's turn begins immediately
  s.deck = makeDeck();
  s.discard = [];
  s.knocker = null;
  s.queue = [];
  s.selected = null;
  s.result = null;
  s.status = "";
  s.log = [];
  for (const p of s.players) p.hand = [];
  const dealt = s.players.filter(isAlive);
  s.dealPlayers = dealt.length;
  for (let r = 0; r < 3; r++) for (const p of dealt) p.hand.push(s.deck.pop()!);
  s.discard.push(s.deck.pop()!);
  s.cur = 0;
  while (isEliminated(s.players[s.cur])) s.cur = (s.cur + 1) % s.players.length;
  // A dealt 31 wins immediately.
  if (scoreHand(s.players[s.cur].hand, s.options) === 31) {
    resolveDeal(s, s.cur);
  } else {
    s.phase = "drawing";
  }
}

/** Safety net: if nobody knocks, force a showdown after this many rounds. */
const MAX_ROUNDS_PER_DEAL = 20;

function endTurn(s: GameState): void {
  if (s.knocker !== null) {
    if (s.queue.length === 0) {
      resolveDeal(s, null);
      return;
    }
    s.cur = s.queue.shift()!;
  } else {
    // Guarantee the deal terminates even if AIs never reach a knock.
    const nextRound =
      s.dealPlayers > 0 ? Math.ceil((s.turnInDeal + 1) / s.dealPlayers) : 1;
    if (nextRound > MAX_ROUNDS_PER_DEAL) {
      resolveDeal(s, null);
      return;
    }
    let next = (s.cur + 1) % s.players.length;
    while (isEliminated(s.players[next])) next = (next + 1) % s.players.length;
    s.cur = next;
  }
  s.turnInDeal += 1;
  s.phase = "drawing";
}

/** Resolve and score the deal. winnerIdx set for an instant 31, else null. */
function resolveDeal(s: GameState, winnerIdx: number | null): void {
  const opts = s.options;
  const participants = s.players.filter((p) => p.hand.length > 0);
  const knockerId = s.knocker !== null ? s.players[s.knocker].id : null;
  const winnerId = winnerIdx !== null ? s.players[winnerIdx].id : null;

  const rows = participants.map((p) => ({
    playerId: p.id,
    score: scoreHand(p.hand, opts),
    isLoser: false,
    livesLost: 0,
    outcome: null as DamageOutcome | null,
  }));
  const rowOf = (id: string) => rows.find((r) => r.playerId === id)!;

  if (winnerId !== null) {
    for (const p of participants) {
      if (p.id !== winnerId) {
        const outcome = takeDamage(p, 1, opts);
        const r = rowOf(p.id);
        r.isLoser = true;
        r.livesLost = 1;
        r.outcome = outcome;
      }
    }
  } else {
    const min = Math.min(...rows.map((r) => r.score));
    for (const p of participants) {
      if (scoreHand(p.hand, opts) !== min) continue;
      const livesLost =
        opts.knockPenalty && knockerId !== null && p.id === knockerId ? 2 : 1;
      const outcome = takeDamage(p, livesLost, opts);
      const r = rowOf(p.id);
      r.isLoser = true;
      r.livesLost = livesLost;
      r.outcome = outcome;
    }
  }

  const rounds =
    s.dealPlayers > 0 ? Math.ceil(s.turnInDeal / s.dealPlayers) : 0;
  s.scoreHistory.push({
    deal: s.dealNum,
    rounds,
    scores: Object.fromEntries(rows.map((r) => [r.playerId, r.score])),
    knockerId,
  });
  s.result = {
    title:
      winnerId !== null
        ? `31! ${s.players[winnerIdx!].name} takes the deal`
        : "Deal Over",
    rows,
  };
  s.phase = "dealEnd";
}

function reshuffle(s: GameState): void {
  if (s.discard.length <= 1) return;
  const top = s.discard.pop()!;
  s.deck = shuffle(s.discard);
  s.discard = [top];
}

function log(
  s: GameState,
  kind: LogEntry["kind"],
  card: CardModel | null,
): void {
  const id = s.log.length === 0 ? 0 : s.log[s.log.length - 1].id + 1;
  s.log.push({ id, actor: s.players[s.cur].name, kind, card });
  if (s.log.length > 30) s.log.shift();
}

/* ── initial state ───────────────────────────────────────────────────────── */

export interface NewGamePlayer {
  id: string;
  name: string;
  isAI: boolean;
  avatarKey: string;
  traits?: GamePlayer["traits"];
  emoji?: string;
  image?: string;
}

/** Build a fresh, pre-deal GameState (call applyAction(_, {type:"deal"}) next). */
export function createGameState(
  players: NewGamePlayer[],
  options: GameState["options"],
): GameState {
  return {
    players: players.map((p): GamePlayer => ({
      ...p,
      lives: 3,
      grace: false,
      hand: [],
    })),
    deck: [],
    discard: [],
    cur: 0,
    knocker: null,
    queue: [],
    phase: "dealEnd", // a no-op starting phase; "deal" begins play
    selected: null,
    options,
    dealNum: 0,
    turnInDeal: 0,
    dealPlayers: 0,
    status: "",
    result: null,
    scoreHistory: [],
    log: [],
    winnerId: null,
  };
}
