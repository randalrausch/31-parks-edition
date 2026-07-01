/**
 * Multiplayer configuration + an SDK-free backend probe. Derived from env only,
 * with NO provider SDK import, so the eager (solo) code path can use it without
 * pulling any client into the initial bundle.
 *
 * Two providers are supported and auto-selected by which env vars are present:
 *   - Azure    — set VITE_API_BASE (e.g. https://<func>.azurewebsites.net/api,
 *                or "/api" when served same-origin behind Static Web Apps).
 *   - Supabase — set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.
 * If both are set, Azure wins. If neither is set, online is disabled and the app
 * runs solo / pass-and-play only.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

export const azureApiBase = (env?.VITE_API_BASE ?? "").replace(/\/+$/, "");
export const supabaseUrl = env?.VITE_SUPABASE_URL;
export const supabaseKey = env?.VITE_SUPABASE_KEY;

export const azureEnabled = Boolean(azureApiBase);
export const supabaseEnabled = Boolean(supabaseUrl && supabaseKey);
export const multiplayerEnabled = azureEnabled || supabaseEnabled;

import { PROTOCOL_VERSION } from "./version";

export interface BackendInfo {
  provider: string;
  version: string;
  /** The backend's wire-protocol version (absent on older backends). */
  protocol?: number;
}

/**
 * Whether this client can safely talk to the given backend. A protocol mismatch
 * means one side was deployed with an incompatible wire contract; the client
 * should tell the user to refresh rather than risk a broken online game. An
 * absent protocol (older backend that predates the field) is treated as
 * compatible so nothing breaks during the rollout.
 */
export function backendCompatible(info: BackendInfo | null): boolean {
  if (!info || info.protocol === undefined) return true;
  return info.protocol === PROTOCOL_VERSION;
}

export { PROTOCOL_VERSION };

/**
 * Ask the configured backend to identify itself (provider + version) via its
 * unauthenticated `version` op. Plain fetch — no SDK — so it's safe to call from
 * the eager bundle. Returns null if multiplayer isn't configured or unreachable.
 */
export async function fetchBackendInfo(): Promise<BackendInfo | null> {
  let url: string | null = null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (azureEnabled) {
    url = `${azureApiBase}/game`;
  } else if (supabaseEnabled) {
    url = `${supabaseUrl}/functions/v1/game`;
    headers.apikey = supabaseKey!;
    headers.Authorization = `Bearer ${supabaseKey}`;
  }
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ op: "version" }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<BackendInfo>;
    return {
      provider: typeof d.provider === "string" ? d.provider : "online",
      version: typeof d.version === "string" ? d.version : "?",
      protocol: typeof d.protocol === "number" ? d.protocol : undefined,
    };
  } catch {
    return null;
  }
}
