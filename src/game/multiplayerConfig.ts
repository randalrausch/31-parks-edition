/**
 * Multiplayer configuration + a tiny SDK-free backend probe. Derived from env
 * only, with NO import of @supabase/supabase-js, so the eager (solo) code path
 * can use it without pulling the Supabase SDK into the initial bundle. The
 * About dialog uses `fetchBackendInfo()` to show what backend is actually live.
 */
const env = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const url = env?.VITE_SUPABASE_URL;
const key = env?.VITE_SUPABASE_KEY;

export const multiplayerEnabled = Boolean(url && key);

export interface BackendInfo {
  provider: string;
  version: string;
}

/**
 * Ask the configured backend to identify itself (provider + version) via its
 * unauthenticated `version` op. Plain fetch — no SDK — so it's safe to call from
 * the eager bundle. Returns null if multiplayer isn't configured or unreachable.
 */
export async function fetchBackendInfo(): Promise<BackendInfo | null> {
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/functions/v1/game`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ op: "version" }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<BackendInfo>;
    return {
      provider: typeof d.provider === "string" ? d.provider : "online",
      version: typeof d.version === "string" ? d.version : "?",
    };
  } catch {
    return null;
  }
}
