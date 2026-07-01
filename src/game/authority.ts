/**
 * Authority — the pure "server brain" for server-authoritative play (sync or
 * async). An Edge Function (or any authority) calls these on top of the
 * `applyAction` reducer; clients receive a per-player redacted view.
 *
 *   applyPlayerAction — validate it's the actor's turn, apply, then settle.
 *   advanceAuthority  — auto-run AI turns until a human is up or the deal/game ends.
 *   redactState       — strip hidden info before sending state to a given player.
 *
 * None of this touches the network, the DB, React, timing, or sound — it's the
 * same kind of pure, testable logic as the reducer, and works identically for
 * live and turn-by-turn-async games.
 */
import type { CardModel } from "../types";
import {
  type GameState,
  planAITurn,
  aiDiscardIndex,
  aiPlayRandomChance,
  DEFAULT_TRAITS,
} from "./engine";
import { applyAction, type GameAction } from "./actions";

/** Placeholder sent in place of any card a viewer must not see. */
export const HIDDEN_CARD: CardModel = {
  id: "hidden",
  rank: "A",
  suit: "spades",
};

/**
 * The full ordered sequence of actions the current AI takes on its turn: either
 * a single `knock`, or a draw (deck or discard) followed by the `discard` chosen
 * from the resulting hand. Pure and shared so the AI plays identically on the
 * server (stepAI applies these immediately) and in the solo UI (useGame applies
 * them with animation beats between) — one source of truth for AI sequencing.
 */
export function aiTurnActions(s: GameState): GameAction[] {
  const plan = planAITurn(s);
  if (plan.kind === "knock") return [{ type: "knock" }];
  if (plan.kind === "takeDiscard") {
    const cardId = s.players[s.cur].hand[plan.handIndex].id;
    return [{ type: "takeDiscard" }, { type: "discard", cardId }];
  }
  // drawDeck → simulate the draw so the discard is chosen from the new hand.
  const drew = applyAction(s, { type: "drawDeck" });
  const p = drew.players[drew.cur];
  const playRandom = Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
  const idx = aiDiscardIndex(p.hand, drew.options, playRandom);
  return [{ type: "drawDeck" }, { type: "discard", cardId: p.hand[idx].id }];
}

/** Run a single AI player's full turn, returning the resulting state. */
function stepAI(s: GameState): GameState {
  return aiTurnActions(s).reduce((state, a) => applyAction(state, a), s);
}

/**
 * Settle a state so it rests on a human's turn (or deal/game end): auto-runs any
 * consecutive AI turns. This is what keeps an async game moving without anyone
 * "hosting" — after a human acts, all following AI turns resolve immediately.
 */
export function advanceAuthority(s: GameState): GameState {
  let state = s;
  let guard = 0;
  while (
    (state.phase === "drawing" || state.phase === "discarding") &&
    state.players[state.cur].isAI &&
    guard++ < 500
  ) {
    state = stepAI(state);
  }
  return state;
}

/**
 * Apply an action submitted by a specific seat, with turn-ownership validation,
 * then settle AI turns. Returns the original state unchanged if the action is
 * not legal for that seat right now (e.g. not your turn).
 */
/** Actions a player may submit on their turn. "deal" is server-internal only. */
const PLAYER_TURN_ACTIONS = new Set<GameAction["type"]>([
  "drawDeck",
  "takeDiscard",
  "discard",
  "knock",
]);

export function applyPlayerAction(state: GameState, seatId: string, action: GameAction): GameState {
  if (action.type === "setShowLog") {
    // A shared table display setting, controlled by the host (seat 0) only, so
    // one player can't reveal/hide the action feed for everyone else. Applies in
    // any phase and never touches turn flow, so it skips AI settling.
    if (state.players[0]?.id !== seatId) return state;
    return settledOrSame(state, applyAction(state, action));
  }
  if (action.type === "nextDeal") {
    if (state.phase !== "dealEnd") return state;
    // Intentionally not seat-restricted: from the deal-end reveal ANY seated
    // player may advance to the next deal, so one idle/away player can't stall
    // an async game. (Callers still pass a valid seat token to reach here.)
    return settledOrSame(state, advanceAuthority(applyAction(state, action)));
  }
  // Reject anything that isn't a legal turn action — notably "deal", which
  // would otherwise let a player re-deal the game mid-turn.
  if (!PLAYER_TURN_ACTIONS.has(action.type)) return state;
  // Turn actions must come from the player whose turn it is.
  if (state.phase !== "drawing" && state.phase !== "discarding") return state;
  if (state.players[state.cur].id !== seatId) return state;
  return settledOrSame(state, advanceAuthority(applyAction(state, action)));
}

/**
 * Return the original `state` reference when an action changed nothing. The
 * reducer clones up front, so a no-op rejected *inside* applyAction (e.g. a
 * discard submitted while still in "drawing", or an unknown card id) yields a
 * new-but-identical object. Collapsing it back lets callers detect a no-op with
 * `===` and skip persisting/broadcasting an unchanged state.
 */
function settledOrSame(state: GameState, next: GameState): GameState {
  return JSON.stringify(next) === JSON.stringify(state) ? state : next;
}

/**
 * Produce the view a given player is allowed to see: their own hand is real;
 * everyone else's hand and the deck are replaced with hidden placeholders (the
 * counts are preserved so fans/badges still render). At deal end and game over
 * every hand is revealed. Pass `null` for a spectator (sees no hands until
 * reveal). The discard pile, tokens, turn, log, and results are always public.
 */
export function redactState(state: GameState, viewerId: string | null): GameState {
  const revealAll = state.phase === "dealEnd" || state.phase === "gameOver";
  return {
    ...state,
    deck: state.deck.map(() => HIDDEN_CARD),
    players: state.players.map((p) =>
      revealAll || p.id === viewerId ? p : { ...p, hand: p.hand.map(() => HIDDEN_CARD) },
    ),
  };
}
