/**
 * useNetworkGame — React binding for a NetworkTransport. Connects on mount,
 * re-renders on every snapshot (own action or Realtime ping), and exposes the
 * actions the online board needs. The server is authoritative, so there's no
 * local AI, deal animation, or pass-the-device cover here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { NetworkTransport, type NetworkSnapshot } from "./networkTransport";
import type { GameAction } from "./actions";

export interface NetworkGameApi {
  snap: NetworkSnapshot | null;
  /** Set if the game couldn't be loaded (e.g. a stale/expired session). */
  error: string | null;
  /** Submit a turn action (only meaningful on your turn). */
  act: (a: GameAction) => void;
  /** Advance from a finished deal to the next one. */
  nextDeal: () => void;
  /** Force a state re-fetch (e.g. right after the host starts the game). */
  refresh: () => void;
}

export function useNetworkGame(
  gameId: string,
  seatToken: string,
): NetworkGameApi {
  const [snap, setSnap] = useState<NetworkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<NetworkTransport | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError("Multiplayer not configured");
      return;
    }
    setError(null);
    const t = new NetworkTransport(supabase, gameId, seatToken);
    ref.current = t;
    const unsub = t.subscribe(setSnap);
    // The initial connect fetch can reject (game gone) — surface it.
    t.connect().catch((e) => setError(String((e as Error)?.message ?? e)));
    return () => {
      unsub();
      t.destroy();
      ref.current = null;
    };
  }, [gameId, seatToken]);

  const act = useCallback((a: GameAction) => {
    void ref.current?.act(a).catch((e) => console.error("act failed", e));
  }, []);
  const nextDeal = useCallback(() => {
    void ref.current
      ?.nextDeal()
      .catch((e) => console.error("nextDeal failed", e));
  }, []);
  const refresh = useCallback(() => {
    void ref.current
      ?.refresh()
      .catch((e) => console.error("refresh failed", e));
  }, []);

  return { snap, error, act, nextDeal, refresh };
}
