/**
 * Lazy-loaded root of the online experience. Everything that pulls in the
 * Supabase SDK lives under here, so the solo app shell never downloads it.
 *
 * Handles the three entry intents — create a game from the setup config, join
 * by code, or resume a saved session after a refresh — and persists the active
 * session to localStorage so a reload drops you straight back into your seat.
 */
import { useEffect, useState } from "react";
import type { CreateConfig } from "../game/supabaseClient";
import { activeBackend } from "../game/backend";
import { elog } from "../game/debug";
import {
  type OnlineSession,
  saveSession,
  clearSession,
} from "../game/onlineSession";
import OnlineGame from "./OnlineGame";
import JoinModal from "./JoinModal";

export type OnlineIntent =
  | { type: "create"; config: CreateConfig }
  | { type: "join" }
  | { type: "resume"; session: OnlineSession };

export default function OnlineRoot({
  intent,
  onExit,
}: {
  intent: OnlineIntent;
  onExit: () => void;
}) {
  const [session, setSession] = useState<OnlineSession | null>(
    intent.type === "resume" ? intent.session : null,
  );
  const [creating, setCreating] = useState(intent.type === "create");
  const [error, setError] = useState<string | null>(null);

  // Create-intent: make the room on mount.
  useEffect(() => {
    if (intent.type !== "create" || !activeBackend) return;
    let cancelled = false;
    activeBackend.api
      .create(intent.config)
      .then((r) => {
        if (cancelled) return;
        const s: OnlineSession = {
          gameId: r.gameId,
          seatToken: r.seatToken,
          code: r.code,
          seatIndex: r.seatIndex,
        };
        saveSession(s);
        setSession(s);
        setCreating(false);
      })
      .catch((e) => {
        if (!cancelled) {
          elog("net", "create failed", e);
          setError((e as Error).message || "Couldn't create the game.");
          setCreating(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [intent]);

  const leave = () => {
    clearSession();
    onExit();
  };

  if (session) {
    return <OnlineGame session={session} onLeave={leave} />;
  }

  if (error) {
    return (
      <div className="lobby">
        <div className="lobby__panel">
          <h1 className="lobby__title">Couldn't Start</h1>
          <p className="lobby__waiting">{error}</p>
          <button className="lobby__leave" type="button" onClick={onExit}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="lobby">
        <div className="lobby__panel">
          <h1 className="lobby__title">Creating game…</h1>
        </div>
      </div>
    );
  }

  // join intent
  return (
    <JoinModal
      open
      onClose={onExit}
      onJoined={(s) => {
        saveSession(s);
        setSession(s);
      }}
    />
  );
}
