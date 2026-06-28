/**
 * Online session identity + persistence — dependency-free so the eager app
 * shell can check for a resumable game without loading the Supabase SDK. A
 * session is the secret a device needs to re-enter its seat.
 *
 * Storage is split so two browser tabs (e.g. two players testing on one machine)
 * never clobber each other:
 *  - sessionStorage holds THIS tab's active session — it's per-tab and survives
 *    a refresh, which is what "rejoin after refresh" needs.
 *  - localStorage keeps a small backup list (keyed by game + seat) so a session
 *    also survives fully closing the tab; it can hold several seats at once.
 * loadSession prefers the per-tab session and only falls back to the most recent
 * backup when this tab has none (a fresh tab, or after a close-and-reopen).
 */
export interface OnlineSession {
  gameId: string;
  seatToken: string;
  code: string;
  seatIndex: number;
}

const ACTIVE_KEY = "parks31.session"; // sessionStorage: this tab's seat
const LIST_KEY = "parks31.sessions"; // localStorage: cross-close backup list
const MAX_BACKUP = 8;

function isValid(s: unknown): s is OnlineSession {
  const o = s as OnlineSession | null;
  return !!o && typeof o.gameId === "string" && typeof o.seatToken === "string";
}

/** Unique per seat so two players in one browser don't overwrite each other. */
const seatKey = (s: OnlineSession) => `${s.gameId}:${s.seatIndex}`;

function readActive(): OnlineSession | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (isValid(s)) return s;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readList(): OnlineSession[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isValid) : [];
  } catch {
    return [];
  }
}

export function loadSession(): OnlineSession | null {
  return readActive() ?? readList()[0] ?? null;
}

export function saveSession(s: OnlineSession): void {
  try {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / storage full — non-fatal */
  }
  try {
    const list = [s, ...readList().filter((x) => seatKey(x) !== seatKey(s))];
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_BACKUP)));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  const active = readActive();
  try {
    sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
  if (!active) return;
  try {
    const list = readList().filter((x) => seatKey(x) !== seatKey(active));
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
