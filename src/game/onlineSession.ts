/**
 * Online session identity + localStorage persistence — dependency-free so the
 * eager app shell can check for a resumable game without loading the Supabase
 * SDK. A session is the secret a device needs to re-enter its seat.
 */
export interface OnlineSession {
  gameId: string;
  seatToken: string;
  code: string;
  seatIndex: number;
}

const KEY = "parks31.session";

export function loadSession(): OnlineSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as OnlineSession;
    return s && s.gameId && s.seatToken ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: OnlineSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / storage full — non-fatal */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
