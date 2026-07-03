/**
 * Solo-game persistence. Solo/pass-and-play state lives only in memory
 * (useGame), so a reload or a render crash used to destroy an in-progress game.
 * We snapshot the authoritative GameState to localStorage at rest points (when
 * the game is waiting on a human — a player's turn or the deal-end screen) and
 * restore it on next load.
 *
 * The SAVE_VERSION guards against a future GameState shape change: a snapshot
 * written by an older build is discarded rather than fed into an engine that can
 * no longer read it (the solo analogue of the server's persisted-state concern).
 */
import type { GameState } from "./engine";

const KEY = "parks31.solo";
const SAVE_VERSION = 1;

interface Saved {
  v: number;
  state: GameState;
}

export function saveSolo(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE_VERSION, state } satisfies Saved));
  } catch {
    /* private mode / quota / no localStorage — persistence is best-effort */
  }
}

export function loadSolo(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    // Discard a snapshot from a different save schema instead of risking a crash
    // feeding a mismatched shape into the engine.
    if (parsed?.v !== SAVE_VERSION || !parsed.state) {
      clearSolo();
      return null;
    }
    return parsed.state;
  } catch {
    clearSolo();
    return null;
  }
}

export function clearSolo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
