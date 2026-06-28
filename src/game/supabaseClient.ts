/**
 * Supabase client + typed wrapper around the `game` Edge Function.
 *
 * The client is created from Vite env vars (VITE_SUPABASE_URL / _KEY). If they
 * aren't set, `supabase` is null and `multiplayerEnabled` is false so the app
 * can hide the online features gracefully. `makeGameApi` is also exported so
 * tests can inject their own client.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameAction, NewGamePlayer } from "./actions";
import type { GameOptions, GameState } from "./engine";
import type { GameBackend } from "./backend";

// Guarded so the module is import-safe outside Vite (e.g. Node tests), where
// import.meta.env is undefined.
const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const url = viteEnv?.VITE_SUPABASE_URL;
const key = viteEnv?.VITE_SUPABASE_KEY;

// Note: the eager/solo code path must NOT import this module (it pulls in the
// Supabase SDK). It uses the SDK-free `multiplayerEnabled` from
// multiplayerConfig.ts instead; this copy is for code that already needs the
// client. Both derive from the same two env vars and agree.
export const multiplayerEnabled = Boolean(url && key);
export const supabase: SupabaseClient | null = multiplayerEnabled
  ? createClient(url!, key!, { realtime: { params: { eventsPerSecond: 5 } } })
  : null;

/** Public seat info shown in the lobby (no card data). */
export interface SeatInfo {
  idx: number;
  name: string | null;
  avatar?: string;
  emoji?: string;
  isAI: boolean;
  filled: boolean;
}

export interface CreateConfig {
  creatorName: string;
  humans: number;
  ai: Omit<NewGamePlayer, "id" | "isAI">[];
  options: GameOptions;
}

export interface GameApi {
  create(config: CreateConfig): Promise<{
    gameId: string;
    code: string;
    seatIndex: number;
    seatToken: string;
  }>;
  join(
    code: string,
    name: string,
  ): Promise<{ gameId: string; seatIndex: number; seatToken: string }>;
  start(gameId: string, seatToken: string): Promise<void>;
  act(gameId: string, seatToken: string, action: GameAction): Promise<void>;
  state(
    gameId: string,
    seatToken?: string,
  ): Promise<{
    status: string;
    version: number;
    seats: SeatInfo[];
    seatIndex: number | null;
    state: GameState;
  }>;
}

export function makeGameApi(client: SupabaseClient): GameApi {
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.functions.invoke("game", { body });
    if (error) {
      // supabase-js wraps any non-2xx as a FunctionsHttpError whose generic
      // message is "Edge Function returned a non-2xx status code". Our real
      // reason (e.g. "Game is full") is the JSON body on the Response in
      // `context` — surface that instead so users see something useful.
      let message = error.message;
      const ctx = (error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        try {
          const payload = await ctx.clone().json();
          if (payload?.error) message = payload.error as string;
        } catch {
          /* body wasn't JSON — keep the generic message */
        }
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data as T;
  }
  return {
    create: (config) => call({ op: "create", config }),
    join: (code, name) =>
      call({ op: "join", code: code.toUpperCase().trim(), name }),
    start: (gameId, seatToken) =>
      call({ op: "start", gameId, seatToken }).then(() => undefined),
    act: (gameId, seatToken, action) =>
      call({ op: "act", gameId, seatToken, action }).then(() => undefined),
    state: (gameId, seatToken) => call({ op: "state", gameId, seatToken }),
  };
}

/** The app-wide game API (null when multiplayer isn't configured). */
export const gameApi: GameApi | null = supabase ? makeGameApi(supabase) : null;

/**
 * Subscribe to a game's public row changes via Supabase Realtime. Maps the
 * channel status to the link-health callback for the reconnecting indicator.
 */
function subscribeToGame(
  client: SupabaseClient,
  gameId: string,
  onChange: () => void,
  onStatus?: (live: boolean) => void,
): () => void {
  const channel = client
    .channel(`game:${gameId}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "games",
        filter: `id=eq.${gameId}`,
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.(true);
      else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      )
        onStatus?.(false);
    });
  return () => void client.removeChannel(channel);
}

/** Supabase implementation of the swappable backend seam (see backend.ts). */
export const supabaseBackend: GameBackend | null =
  supabase && gameApi
    ? {
        name: "Supabase",
        api: gameApi,
        subscribe: (gameId, onChange, onStatus) =>
          subscribeToGame(supabase!, gameId, onChange, onStatus),
      }
    : null;
