/**
 * Storage abstraction for the authority. Two implementations:
 *   - MemoryGameStore  (tests; deterministic, no emulator)
 *   - TableGameStore   (Azure Table Storage, managed identity)
 *
 * The public lobby record and the secret record (full state + seat tokens) are
 * written together as ONE atomic unit (same partition, batch transaction in the
 * Table impl), gated by the lobby record's ETag for optimistic concurrency. A
 * losing writer gets `update() === false` and the caller returns a 409 "retry".
 */
import type { GameState } from "./engine";

/** Public, client-visible seat summary (no cards). */
export interface SeatInfo {
  idx: number;
  name: string | null;
  avatar: string;
  emoji?: string | null;
  isAI: boolean;
  filled: boolean;
}

/** Public lobby record (mirrors the old `games` row). */
export interface GameRecord {
  gameId: string;
  code: string;
  status: string; // "lobby" | "playing" | "over"
  version: number; // client-visible change counter (separate from the ETag)
  seats: SeatInfo[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 — drives the cleanup timer
}

/** Secret record — never leaves the server un-redacted (mirrors `game_secrets`). */
export interface SecretRecord {
  state: GameState;
  seatTokens: Record<string, number>; // token -> seatIndex
}

export interface GameStore {
  /** Create a new game: writes the code index, then the game+secret pair. */
  createGame(rec: GameRecord, secret: SecretRecord): Promise<void>;
  /** Resolve a join code to a gameId (case-insensitive), or null. */
  getByCode(code: string): Promise<string | null>;
  /** Load the public record + its current ETag, or null if missing. */
  getGame(gameId: string): Promise<{ rec: GameRecord; etag: string } | null>;
  /** Load the secret record, or null if missing. */
  getSecret(gameId: string): Promise<SecretRecord | null>;
  /**
   * Atomic compare-and-set: replace the game+secret pair iff the public record's
   * ETag still matches `etag`. Resolves false on a mismatch (caller -> 409 retry).
   */
  update(gameId: string, etag: string, rec: GameRecord, secret: SecretRecord): Promise<boolean>;
  /** Delete games whose expiresAt is at or before `nowIso`. Returns the count. */
  deleteExpired(nowIso: string): Promise<number>;
}

/** Thrown when a serialized state would exceed the Table Storage property cap. */
export class StateTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Game state too large to persist: ${bytes} bytes`);
    this.name = "StateTooLargeError";
  }
}
