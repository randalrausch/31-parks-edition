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

/**
 * Max serialized-state size (in UTF-16 code units — JS string `.length`) both
 * stores accept before rejecting with StateTooLargeError. Bound by the TIGHTER
 * backend: an Azure Table Storage String property caps at 64 KB = 32,768 UTF-16
 * units, so cap below that with margin. Postgres `jsonb` has no such limit, but
 * both stores share this constant so a game behaves identically on either backend
 * (an oversized state fails the same 507 on both) and an unbounded row can't
 * become a DoS/cost vector. Realistic states are a few KB (the log is capped at
 * 30 entries), so this is generous headroom.
 *
 * NB: this is a character count, not a byte count — the guard compares it against
 * `JSON.stringify(state).length`, and Table Storage's 64 KB limit is on the
 * UTF-16 encoding, i.e. 32,768 code units.
 */
export const MAX_STATE_BYTES = 32_000;

/** Thrown when a serialized state would exceed the persistence size cap. */
export class StateTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Game state too large to persist: ${bytes} bytes`);
    this.name = "StateTooLargeError";
  }
}

/**
 * Thrown by createGame when the join code already belongs to another game, so
 * the caller (handleCreate) can regenerate the code and retry rather than
 * silently clobbering a live lobby. Both store adapters raise it on a code
 * collision, keeping behavior identical across backends.
 */
export class CodeCollisionError extends Error {
  constructor(code: string) {
    super(`Join code already in use: ${code}`);
    this.name = "CodeCollisionError";
  }
}
