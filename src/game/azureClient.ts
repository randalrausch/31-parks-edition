/**
 * Azure backend: a plain-fetch implementation of GameApi against the Azure
 * Functions endpoint (`${VITE_API_BASE}/game`), plus the GameBackend it powers.
 *
 * There is no realtime push, so `subscribe` is a no-op — NetworkTransport's poll
 * keeps everyone converged (the game is async/turn-based). No SDK, so this is
 * cheap to include. Selected by backend.ts when VITE_API_BASE is set.
 */
import type { GameAction } from "./actions";
import { BackendError, type GameApi } from "./gameApi";
import type { GameBackend } from "./backend";
import { azureApiBase, azureEnabled } from "./multiplayerConfig";
import { PROTOCOL_VERSION } from "./version";

// Abort a request that never settles (e.g. a half-open connection on a mobile
// network handoff). Without this, one stuck fetch would leave NetworkTransport's
// `fetching` guard set forever, silently killing its safety-net poll.
const REQUEST_TIMEOUT_MS = 10_000;

export function makeGameApi(base: string): GameApi {
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tag every request with the wire-protocol version so the server can
        // reject a client that's gone stale across a breaking deploy (426).
        body: JSON.stringify({ protocol: PROTOCOL_VERSION, ...body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Couldn't reach the game server. Check your connection.");
    }
    let data: { error?: string } | null = null;
    try {
      data = (await res.json()) as { error?: string };
    } catch {
      /* non-JSON body */
    }
    // A non-2xx carries the HTTP status; NetworkTransport treats 409 (conflict)
    // as recoverable and resyncs instead of surfacing an error.
    if (!res.ok)
      throw new BackendError(
        data?.error || `Request failed (${res.status}).`,
        res.status,
        res.status === 409,
        res.status === 426,
      );
    if (data?.error) throw new Error(data.error);
    return data as T;
  }

  return {
    create: (config) => call({ op: "create", config }),
    join: (code, name) => call({ op: "join", code: code.toUpperCase().trim(), name }),
    start: (gameId, seatToken) => call({ op: "start", gameId, seatToken }).then(() => undefined),
    act: (gameId, seatToken, action: GameAction) =>
      call({ op: "act", gameId, seatToken, action }).then(() => undefined),
    state: (gameId, seatToken) => call({ op: "state", gameId, seatToken }),
  };
}

export const azureGameApi: GameApi | null = azureEnabled ? makeGameApi(azureApiBase) : null;

/** Azure implementation of the swappable backend seam (see backend.ts). */
export const azureBackend: GameBackend | null = azureGameApi
  ? {
      name: "Azure",
      api: azureGameApi,
      // No push channel — polling in NetworkTransport drives convergence.
      subscribe: () => () => {},
      // Fire-and-forget crash report to the Function's logs. keepalive lets it
      // survive a page unload; failures are swallowed so it never worsens a crash.
      reportError: (report) => {
        try {
          void fetch(`${azureApiBase}/game`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "clientError", ...report }),
            keepalive: true,
          }).catch(() => {});
        } catch {
          /* never throw from the error reporter */
        }
      },
    }
  : null;
