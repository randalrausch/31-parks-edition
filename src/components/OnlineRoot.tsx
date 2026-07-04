/**
 * Lazy-loaded root of the online experience. Everything that pulls in the
 * Supabase SDK lives under here, so the solo app shell never downloads it.
 *
 * Handles the three entry intents — create a game from the setup config, join
 * by code, or resume a saved session after a refresh — and persists the active
 * session to localStorage so a reload drops you straight back into your seat.
 */
import { useEffect, useState } from "react";
import type { CreateConfig } from "../game/gameApi";
import { activeBackend } from "../game/backend";
import { fetchBackendInfo, backendCompatible } from "../game/multiplayerConfig";
import { elog } from "../game/debug";
import { type OnlineSession, saveSession, clearSession } from "../game/onlineSession";
import OnlineGame from "./OnlineGame";
import JoinModal from "./JoinModal";
import UpdatePrompt from "./UpdatePrompt";

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
  // Protocol preflight: don't let a stale tab start an online game against a
  // backend it may not understand. "checking" until the probe returns; "stale"
  // only on a definite protocol mismatch (unreachable/older backends pass).
  const [compat, setCompat] = useState<"checking" | "ok" | "stale">("checking");

  useEffect(() => {
    let cancelled = false;
    fetchBackendInfo().then((info) => {
      if (!cancelled) setCompat(backendCompatible(info) ? "ok" : "stale");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Create-intent: make the room once the compatibility check has passed.
  useEffect(() => {
    if (intent.type !== "create" || !activeBackend || compat !== "ok") return;
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
  }, [intent, compat]);

  const leave = () => {
    clearSession();
    onExit();
  };

  // Out-of-date tab: the live backend speaks a different wire protocol.
  if (compat === "stale") {
    return <UpdatePrompt />;
  }

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
