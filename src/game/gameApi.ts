/**
 * Provider-neutral online types. These describe the wire contract the app
 * depends on; a concrete backend (azureClient.ts) implements GameApi, and
 * backend.ts selects the active one. No provider SDK is referenced here.
 */
import type { GameAction, NewGamePlayer } from "./actions";
import type { GameOptions, GameState } from "./engine";

/**
 * A backend request failure carrying the HTTP status, so callers can react to
 * kinds of failure structurally instead of matching words in the message. In
 * particular `conflict` (HTTP 409) means the authority already moved on — a
 * concurrent/duplicate submit — which the transport treats as recoverable
 * (silently resync) rather than surfacing to the player.
 */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly conflict = false,
    /** HTTP 426: the client's PROTOCOL_VERSION no longer matches the server. */
    readonly outdated = false,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** Public seat info shown in the lobby (no card data). */
export interface SeatInfo {
  idx: number;
  name: string | null;
  avatar?: string;
  emoji?: string;
  isAI: boolean;
  filled: boolean;
}

export interface CreateConfig {
  creatorName: string;
  humans: number;
  ai: Omit<NewGamePlayer, "id" | "isAI">[];
  options: GameOptions;
}

export interface GameApi {
  create(config: CreateConfig): Promise<{
    gameId: string;
    code: string;
    seatIndex: number;
    seatToken: string;
  }>;
  join(
    code: string,
    name: string,
  ): Promise<{ gameId: string; seatIndex: number; seatToken: string }>;
  start(gameId: string, seatToken: string): Promise<void>;
  /** Host-only lobby rename of a seat (human or AI). No-ops off the happy path
   * are surfaced as BackendError so the caller can show why it didn't take. */
  rename(gameId: string, seatToken: string, seatIndex: number, name: string): Promise<void>;
  act(gameId: string, seatToken: string, action: GameAction): Promise<void>;
  state(
    gameId: string,
    seatToken?: string,
  ): Promise<{
    status: string;
    version: number;
    seats: SeatInfo[];
    seatIndex: number | null;
    state: GameState;
  }>;
}
