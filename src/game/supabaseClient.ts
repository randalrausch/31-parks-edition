/**
 * Supabase backend: a typed wrapper around the `game` Edge Function plus a
 * Realtime change subscription. Selected by backend.ts when VITE_SUPABASE_URL /
 * VITE_SUPABASE_KEY are set (and Azure isn't). The provider-neutral types live
 * in gameApi.ts; the env probe lives in multiplayerConfig.ts.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { BackendError, type GameApi } from "./gameApi";
import type { GameBackend } from "./backend";
import { supabaseEnabled, supabaseKey, supabaseUrl } from "./multiplayerConfig";
import { PROTOCOL_VERSION } from "./version";

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(supabaseUrl!, supabaseKey!, {
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

// Abort a request that never settles (e.g. a half-open connection on a mobile
// network handoff). Without this, one stuck invoke would leave NetworkTransport's
// `fetching` guard set forever, silently killing its safety-net poll.
const REQUEST_TIMEOUT_MS = 10_000;

export function makeGameApi(client: SupabaseClient): GameApi {
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const invoke = () =>
      client.functions.invoke("game", {
        // Tag every request with the wire-protocol version so the server can
        // reject a client that's gone stale across a breaking deploy (426).
        body: { protocol: PROTOCOL_VERSION, ...body },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    let res: Awaited<ReturnType<typeof invoke>>;
    try {
      res = await invoke();
    } catch {
      // A timeout/abort or transport failure rejects here (rather than
      // returning `error`); surface a clear message so the transport flips to
      // "reconnecting" and re-arms its poll instead of hanging.
      throw new Error("Couldn't reach the game server. Check your connection.");
    }
    const { data, error } = res;
    if (error) {
      // supabase-js wraps any non-2xx as a FunctionsHttpError whose generic
      // message is "Edge Function returned a non-2xx status code". Our real
      // reason (e.g. "Game is full") is the JSON body on the Response in
      // `context` — surface that instead so users see something useful.
      let message = error.message;
      let status: number | undefined;
      const ctx = (error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        status = ctx.status;
        try {
          const payload = await ctx.clone().json();
          if (payload?.error) message = payload.error as string;
        } catch {
          /* body wasn't JSON — keep the generic message */
        }
      }
      // Carry the status so the transport can treat a 409 conflict as a
      // recoverable resync rather than a user-facing error, and a 426 as
      // "client outdated — refresh".
      throw new BackendError(message, status, status === 409, status === 426);
    }
    if (data?.error) throw new Error(data.error);
    return data as T;
  }
  return {
    create: (config) => call({ op: "create", config }),
    join: (code, name) => call({ op: "join", code: code.toUpperCase().trim(), name }),
    start: (gameId, seatToken) => call({ op: "start", gameId, seatToken }).then(() => undefined),
    act: (gameId, seatToken, action) =>
      call({ op: "act", gameId, seatToken, action }).then(() => undefined),
    state: (gameId, seatToken) => call({ op: "state", gameId, seatToken }),
  };
}

/** The Supabase game API (null when Supabase isn't configured). */
export const gameApi: GameApi | null = supabase ? makeGameApi(supabase) : null;

/**
 * Subscribe to a game's public row changes via Supabase Realtime, with automatic
 * resubscribe-with-backoff. Maps the channel status to the link-health callback
 * (drives the "reconnecting" indicator). On CHANNEL_ERROR / TIMED_OUT / CLOSED the
 * dead channel is torn down and a fresh one created after a capped, jittered
 * delay — so a dropped channel recovers instead of silently leaving the client on
 * the poll-only safety net. Callbacks from a channel we've superseded are ignored,
 * so the teardown can't trigger a reconnect loop.
 */
export function subscribeToGame(
  client: SupabaseClient,
  gameId: string,
  onChange: () => void,
  onStatus?: (live: boolean) => void,
): () => void {
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (disposed) return;
    const ch = client
      .channel(`game:${gameId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        () => onChange(),
      );
    channel = ch; // set BEFORE subscribe so the guard never drops our own callback
    ch.subscribe((status) => {
      if (disposed || ch !== channel) return; // ignore a channel we've moved on from
      if (status === "SUBSCRIBED") {
        attempt = 0;
        onStatus?.(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        onStatus?.(false);
        reconnect();
      }
    });
  };

  const reconnect = (): void => {
    if (disposed || retryTimer) return;
    const dead = channel;
    channel = null;
    if (dead) void client.removeChannel(dead);
    // Capped exponential backoff with jitter so a flapping connection can't spin.
    const delay = Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 400;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  connect();
  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (channel) void client.removeChannel(channel);
  };
}

/** Supabase implementation of the swappable backend seam (see backend.ts). */
export const supabaseBackend: GameBackend | null =
  supabase && gameApi
    ? {
        name: "Supabase",
        api: gameApi,
        subscribe: (gameId, onChange, onStatus) =>
          subscribeToGame(supabase!, gameId, onChange, onStatus),
        // Fire-and-forget crash report to the Edge Function's logs. A raw fetch
        // with keepalive (rather than functions.invoke, which can't set it) lets
        // the report survive a page unload — the common case for a crash report,
        // which otherwise dies with the tab. Failures are swallowed so the
        // reporter never worsens the error it's reporting.
        reportError: (report) => {
          try {
            void fetch(`${supabaseUrl}/functions/v1/game`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: supabaseKey!,
                Authorization: `Bearer ${supabaseKey!}`,
              },
              body: JSON.stringify({ op: "clientError", ...report }),
              keepalive: true,
            }).catch(() => {});
          } catch {
            /* never throw from the error reporter */
          }
        },
      }
    : null;
