/**
 * Orchestrates one online game session: subscribes via useNetworkGame and shows
 * the Lobby while status is "lobby", then the OnlineGameBoard once it's playing.
 * If the session can't be loaded (game gone/expired), it drops back to the menu.
 */
import { useEffect, useState } from "react";
import { useNetworkGame } from "../game/useNetworkGame";
import { gameApi } from "../game/supabaseClient";
import type { OnlineSession } from "../game/onlineSession";
import Lobby from "./Lobby";
import OnlineGameBoard from "./OnlineGameBoard";

export default function OnlineGame({
  session,
  onLeave,
}: {
  session: OnlineSession;
  onLeave: () => void;
}) {
  const game = useNetworkGame(session.gameId, session.seatToken);
  const [starting, setStarting] = useState(false);

  // A dead/expired game (e.g. a stale resumed session) → return to the menu.
  useEffect(() => {
    if (game.error) onLeave();
  }, [game.error, onLeave]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await gameApi?.start(session.gameId, session.seatToken);
      game.refresh(); // transition to the board without waiting for the ping
    } catch (e) {
      console.error("start failed", e);
      setStarting(false);
    }
  };

  const snap = game.snap;
  if (!snap) {
    return (
      <div className="lobby">
        <div className="lobby__panel">
          <h1 className="lobby__title">
            {game.error ? "Game not found" : "Connecting…"}
          </h1>
          {game.error && (
            <button className="lobby__leave" type="button" onClick={onLeave}>
              Back to menu
            </button>
          )}
        </div>
      </div>
    );
  }

  if (snap.status === "lobby") {
    return (
      <Lobby
        snap={snap}
        code={session.code}
        isHost={session.seatIndex === 0}
        onStart={start}
        onLeave={onLeave}
      />
    );
  }

  return <OnlineGameBoard game={game} onLeave={onLeave} />;
}
