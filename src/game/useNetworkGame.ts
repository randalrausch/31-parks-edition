/**
 * useNetworkGame — React binding for a NetworkTransport. Connects on mount,
 * re-renders on every snapshot (own action or Realtime ping), and exposes the
 * actions the online board needs. The server is authoritative, so there's no
 * local AI, deal animation, or pass-the-device cover here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { activeBackend } from "./backend";
import { NetworkTransport, type NetworkSnapshot } from "./networkTransport";
import { elog } from "./debug";
import type { GameAction } from "./actions";

export interface NetworkGameApi {
  snap: NetworkSnapshot | null;
  /** Set if the game couldn't be loaded (e.g. a stale/expired session). */
  error: string | null;
  /** True once the live backend speaks a newer wire protocol — the tab must
   * refresh. Terminal: sync has stopped. */
  outdated: boolean;
  /** False while we've lost the connection and are trying to resync. */
  connected: boolean;
  /** A transient, dismissible message when a move couldn't be sent. */
  actionError: string | null;
  /** Clear the transient action error (e.g. when the user dismisses it). */
  clearActionError: () => void;
  /** Submit a turn action (only meaningful on your turn). */
  act: (a: GameAction) => void;
  /** Advance from a finished deal to the next one. */
  nextDeal: () => void;
  /** Force a state re-fetch (e.g. right after the host starts the game). */
  refresh: () => void;
}

/** A short, human description of an action for error messages. */
function describeAction(a: GameAction): string {
  switch (a.type) {
    case "drawDeck":
      return "draw from the deck";
    case "takeDiscard":
      return "take the discard";
    case "discard":
      return "discard";
    case "knock":
      return "knock";
    case "nextDeal":
      return "continue to the next deal";
    case "setShowLog":
      return a.value ? "show the action log" : "hide the action log";
    default:
      return "do that";
  }
}

export function useNetworkGame(gameId: string, seatToken: string): NetworkGameApi {
  const [snap, setSnap] = useState<NetworkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const ref = useRef<NetworkTransport | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashError = useCallback((msg: string) => {
    setActionError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setActionError(null), 6000);
  }, []);
  const clearActionError = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setActionError(null);
  }, []);

  useEffect(() => {
    if (!activeBackend) {
      setError("Multiplayer isn't configured for this site.");
      return;
    }
    setError(null);
    setOutdated(false);
    setConnected(true);
    const t = new NetworkTransport(activeBackend, gameId, seatToken);
    ref.current = t;
    const unsub = t.subscribe(setSnap);
    const unsubStatus = t.onStatus(setConnected);
    const unsubOutdated = t.onOutdated(() => setOutdated(true));
    // The initial connect fetch can reject (game gone / network) — surface it.
    t.connect().catch((e) => {
      elog("net", "connect failed", e);
      setError((e as Error)?.message || "Couldn't connect to the game.");
    });
    // Resync immediately when the browser regains connectivity, and when a
    // backgrounded tab (mobile especially, where the poll is heavily throttled)
    // becomes visible again — otherwise a returning player can sit on stale
    // state until the next slow poll ticks.
    const onOnline = () => void t.refresh().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") void t.refresh().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
      unsubStatus();
      unsubOutdated();
      t.destroy();
      ref.current = null;
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [gameId, seatToken]);

  const submit = useCallback(
    (a: GameAction) => {
      void ref.current?.act(a).catch((e) => {
        elog("net", `${a.type} failed`, e);
        flashError(`Couldn't ${describeAction(a)} — check your connection and try again.`);
      });
    },
    [flashError],
  );
  const act = submit;
  const nextDeal = useCallback(() => submit({ type: "nextDeal" }), [submit]);
  const refresh = useCallback(() => {
    void ref.current?.refresh().catch((e) => elog("net", "refresh failed", e));
  }, []);

  return {
    snap,
    error,
    outdated,
    connected,
    actionError,
    clearActionError,
    act,
    nextDeal,
    refresh,
  };
}
