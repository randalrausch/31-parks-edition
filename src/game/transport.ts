/**
 * Transport — the seam between the UI and the authoritative game.
 *
 * The UI never mutates state directly; it sends GameActions through a Transport
 * and re-renders whatever state the transport publishes. LocalTransport runs
 * the reducer in-process (single device: hotseat + AI). A future
 * NetworkTransport (Supabase / PartyKit / Durable Object) implements the same
 * interface — sending actions to an authority that runs the very same
 * `applyAction` and broadcasts the resulting state — with zero UI changes.
 */
import {
  type GameState,
  planAITurn,
  aiDiscardIndex,
  aiPlayRandomChance,
  DEFAULT_TRAITS,
} from "./engine";
import {
  applyAction,
  createGameState,
  type GameAction,
  type NewGamePlayer,
} from "./actions";

export interface Transport {
  getState(): GameState | null;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (state: GameState) => void): () => void;
  /** Begin a new game and deal the first hand. */
  start(players: NewGamePlayer[], options: GameState["options"]): void;
  /** Submit an authoritative action. */
  dispatch(action: GameAction): void;
  /**
   * Which seat this client controls. null = this client controls every seat
   * (local play). A networked transport returns the local player's id.
   */
  readonly seatId: string | null;
  destroy(): void;
}

export class LocalTransport implements Transport {
  readonly seatId: string | null = null; // local play controls all seats
  private state: GameState | null = null;
  private listeners = new Set<(s: GameState) => void>();

  getState() {
    return this.state;
  }

  subscribe(listener: (s: GameState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    if (this.state) for (const l of this.listeners) l(this.state);
  }

  start(players: NewGamePlayer[], options: GameState["options"]) {
    this.state = applyAction(createGameState(players, options), {
      type: "deal",
    });
    this.emit();
  }

  dispatch(action: GameAction) {
    if (!this.state) return;
    this.state = applyAction(this.state, action);
    this.emit();
  }

  destroy() {
    this.listeners.clear();
    this.state = null;
  }
}

/**
 * Drive one full turn for the current player by translating the AI plan into
 * dispatched actions. Used to run AI seats locally (and to drive headless
 * simulations). A draw-from-deck turn needs two steps because the discard
 * choice depends on the freshly drawn card.
 */
export function runAITurn(t: Transport): void {
  const s = t.getState();
  if (!s || (s.phase !== "drawing" && s.phase !== "discarding")) return;
  const plan = planAITurn(s);

  if (plan.kind === "knock") {
    t.dispatch({ type: "knock" });
    return;
  }

  if (plan.kind === "takeDiscard") {
    // The card to discard is the original hand card at handIndex (captured now).
    const cardId = s.players[s.cur].hand[plan.handIndex].id;
    t.dispatch({ type: "takeDiscard" });
    t.dispatch({ type: "discard", cardId });
    return;
  }

  // drawDeck: draw first, then choose a discard from the new hand.
  t.dispatch({ type: "drawDeck" });
  const s2 = t.getState();
  if (!s2 || s2.phase !== "discarding") return;
  const p = s2.players[s2.cur];
  const playRandom =
    Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
  const idx = aiDiscardIndex(p.hand, s2.options, playRandom);
  t.dispatch({ type: "discard", cardId: p.hand[idx].id });
}
