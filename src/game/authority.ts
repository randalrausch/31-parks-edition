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

/** Run a single AI player's full turn, returning the resulting state. */
function stepAI(s: GameState): GameState {
  const plan = planAITurn(s);
  if (plan.kind === "knock") return applyAction(s, { type: "knock" });
  if (plan.kind === "takeDiscard") {
    const cardId = s.players[s.cur].hand[plan.handIndex].id;
    return applyAction(applyAction(s, { type: "takeDiscard" }), {
      type: "discard",
      cardId,
    });
  }
  // drawDeck → choose a discard from the new hand
  const drew = applyAction(s, { type: "drawDeck" });
  const p = drew.players[drew.cur];
  const playRandom =
    Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
  const idx = aiDiscardIndex(p.hand, drew.options, playRandom);
  return applyAction(drew, { type: "discard", cardId: p.hand[idx].id });
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

export function applyPlayerAction(
  state: GameState,
  seatId: string,
  action: GameAction,
): GameState {
  if (action.type === "nextDeal") {
    if (state.phase !== "dealEnd") return state;
    return advanceAuthority(applyAction(state, action));
  }
  // Reject anything that isn't a legal turn action — notably "deal", which
  // would otherwise let a player re-deal the game mid-turn.
  if (!PLAYER_TURN_ACTIONS.has(action.type)) return state;
  // Turn actions must come from the player whose turn it is.
  if (state.phase !== "drawing" && state.phase !== "discarding") return state;
  if (state.players[state.cur].id !== seatId) return state;
  return advanceAuthority(applyAction(state, action));
}

/**
 * Produce the view a given player is allowed to see: their own hand is real;
 * everyone else's hand and the deck are replaced with hidden placeholders (the
 * counts are preserved so fans/badges still render). At deal end and game over
 * every hand is revealed. Pass `null` for a spectator (sees no hands until
 * reveal). The discard pile, tokens, turn, log, and results are always public.
 */
export function redactState(
  state: GameState,
  viewerId: string | null,
): GameState {
  const revealAll = state.phase === "dealEnd" || state.phase === "gameOver";
  return {
    ...state,
    deck: state.deck.map(() => HIDDEN_CARD),
    players: state.players.map((p) =>
      revealAll || p.id === viewerId
        ? p
        : { ...p, hand: p.hand.map(() => HIDDEN_CARD) },
    ),
  };
}
