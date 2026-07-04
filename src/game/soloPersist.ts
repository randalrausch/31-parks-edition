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
 * SAVE_VERSION is bumped by hand, so as a second line of defense loadSolo also
 * structurally validates the snapshot, and a "resume guard" (below) detects a
 * save that crashed the app on a previous resume so it's discarded rather than
 * reloaded into an endless crash loop.
 */
import type { GameState } from "./engine";

const KEY = "parks31.solo";
// Session-scoped marker set while a resume is in flight; if it survives a reload
// (i.e. the resume crashed before GameBoard mounted and cleared it), the save is
// poison and the next resume discards it. sessionStorage so it clears when the
// tab closes but survives the crash+reload within the same tab.
const RESUME_GUARD = "parks31.solo.resuming";
const SAVE_VERSION = 1;

interface Saved {
  v: number;
  state: GameState;
}

/**
 * Cheap structural check of the fields the reducer and board immediately touch
 * (`state.players[state.cur].hand`, the piles, the phase). A snapshot that
 * passed the version gate but has the wrong shape (e.g. an engine field renamed
 * without a SAVE_VERSION bump) is rejected here before it can crash a render.
 */
function isPlausibleSoloState(x: unknown): x is GameState {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    Array.isArray(s.players) &&
    s.players.length > 0 &&
    s.players.every(
      (p) =>
        !!p && typeof p === "object" && Array.isArray((p as GameState["players"][number]).hand),
    ) &&
    Array.isArray(s.deck) &&
    Array.isArray(s.discard) &&
    typeof s.cur === "number" &&
    typeof s.phase === "string" &&
    !!s.options &&
    typeof s.options === "object"
  );
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
    // Discard a snapshot from a different save schema, or one whose shape the
    // current engine can't read, instead of risking a crash feeding it in.
    if (parsed?.v !== SAVE_VERSION || !isPlausibleSoloState(parsed.state)) {
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

/** True if a resume was started but never confirmed healthy (survived a reload). */
export function soloResumeCrashed(): boolean {
  try {
    return sessionStorage.getItem(RESUME_GUARD) === "1";
  } catch {
    return false;
  }
}

/** Mark that a resume is in flight (cleared once the board mounts cleanly). */
export function markSoloResuming(): void {
  try {
    sessionStorage.setItem(RESUME_GUARD, "1");
  } catch {
    /* no sessionStorage — fall back to structural validation + try/catch */
  }
}

/** Clear the resume guard — called when the board mounts without crashing. */
export function clearSoloResuming(): void {
  try {
    sessionStorage.removeItem(RESUME_GUARD);
  } catch {
    /* ignore */
  }
}
