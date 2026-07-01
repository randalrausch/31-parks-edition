/**
 * Transport — the seam between the UI and the authoritative game.
 *
 * The UI never mutates state directly; it sends GameActions through a transport
 * and re-renders whatever state the transport publishes. LocalTransport (below)
 * implements this synchronous interface and runs the reducer in-process (single
 * device: hotseat + AI). Online play is the same idea over the network but with
 * an async, lobby-oriented shape, so it lives in a sibling type, NetworkTransport
 * (networkTransport.ts), rather than implementing this interface directly — it
 * forwards actions to the Edge Function authority that runs the very same
 * `applyAction` and broadcasts the resulting (redacted) state.
 */
import { type GameState } from "./engine";
import { applyAction, createGameState, type GameAction, type NewGamePlayer } from "./actions";

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
