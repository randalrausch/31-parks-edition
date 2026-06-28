/**
 * Backend seam.
 *
 * Online play talks to the server ONLY through this interface, so the provider
 * can be swapped without touching the rest of the app. Supabase is the current
 * implementation; an Azure Static Web Apps + Azure Functions/Tables backend (or
 * any other) just needs to implement `GameBackend` and be selected as
 * `activeBackend` below. Nothing outside the chosen implementation imports a
 * provider SDK.
 *
 * The contract is deliberately small: the HTTP-style game API (create/join/
 * start/act/state/version) plus an optional change subscription. Realtime push
 * is optional — NetworkTransport also polls, so a provider with no push can
 * return a no-op from `subscribe()` and still work.
 */
import type { GameApi } from "./supabaseClient";
import { supabaseBackend } from "./supabaseClient";

export interface GameBackend {
  /** Provider name shown in the About dialog (e.g. "Supabase"). */
  readonly name: string;
  /** Transport-agnostic game API. */
  readonly api: GameApi;
  /**
   * Subscribe to "something changed" pings for a game; returns an unsubscribe.
   * `onStatus` (optional) reports push-connection health for the reconnecting
   * indicator. A push-less provider can ignore both and rely on polling.
   */
  subscribe(
    gameId: string,
    onChange: () => void,
    onStatus?: (live: boolean) => void,
  ): () => void;
}

/**
 * The backend in use. Swapping providers is a one-line change here (plus a new
 * GameBackend implementation). `null` when no backend is configured → the app
 * runs solo / pass-and-play only.
 */
export const activeBackend: GameBackend | null = supabaseBackend;
