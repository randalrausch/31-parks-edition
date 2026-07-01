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
import type { GameApi } from "./gameApi";
import { azureBackend } from "./azureClient";
import { supabaseBackend } from "./supabaseClient";

/** A bounded, best-effort report of a client-side error, sent off-device. */
export interface ClientErrorReport {
  message: string;
  stack?: string;
  url?: string;
  context?: string;
}

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
  subscribe(gameId: string, onChange: () => void, onStatus?: (live: boolean) => void): () => void;
  /**
   * Fire-and-forget report of a client error to the backend's logs. Best-effort:
   * never throws, never blocks. Optional — a provider may omit it.
   */
  reportError?(report: ClientErrorReport): void;
}

/**
 * The backend in use, auto-selected by configuration: Azure (VITE_API_BASE) is
 * preferred, then Supabase (VITE_SUPABASE_URL/_KEY). `null` when neither is
 * configured → the app runs solo / pass-and-play only. Adding a provider means
 * implementing GameBackend and slotting it into this preference chain.
 */
export const activeBackend: GameBackend | null = azureBackend ?? supabaseBackend ?? null;
