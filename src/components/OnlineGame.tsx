/**
 * Orchestrates one online game session: subscribes via useNetworkGame and shows
 * the Lobby while status is "lobby", then the OnlineGameBoard once it's playing.
 * If the session can't be loaded (game gone/expired), it drops back to the menu.
 */
import { useState } from "react";
import { useNetworkGame } from "../game/useNetworkGame";
import { activeBackend } from "../game/backend";
import { elog } from "../game/debug";
import type { OnlineSession } from "../game/onlineSession";
import Lobby from "./Lobby";
import OnlineGameBoard from "./OnlineGameBoard";
import UpdatePrompt from "./UpdatePrompt";

export default function OnlineGame({
  session,
  onLeave,
}: {
  session: OnlineSession;
  onLeave: () => void;
}) {
  const game = useNetworkGame(session.gameId, session.seatToken);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await activeBackend?.api.start(session.gameId, session.seatToken);
      game.refresh(); // transition to the board without waiting for the ping
    } catch (e) {
      elog("net", "start failed", e);
      setStartError((e as Error)?.message || "Couldn't start the game.");
      setStarting(false);
    }
  };

  // Host-only lobby rename. On success we refresh so the change shows without
  // waiting for the poll/ping; on failure we surface a brief message and let the
  // seat snap back to the authoritative name on the next snapshot.
  const rename = async (seatIndex: number, name: string) => {
    setRenameError(null);
    try {
      await activeBackend?.api.rename(session.gameId, session.seatToken, seatIndex, name);
      game.refresh();
    } catch (e) {
      elog("net", "rename failed", e);
      setRenameError((e as Error)?.message || "Couldn't rename that player.");
    }
  };

  // A protocol bump deploys backend-first, so a tab already in this game starts
  // getting 426s. This is terminal (sync has stopped) and takes precedence over
  // any last-good snapshot — the only fix is to refresh.
  if (game.outdated) {
    return <UpdatePrompt />;
  }

  const snap = game.snap;
  if (!snap) {
    // No snapshot yet: either still connecting, or the initial load failed
    // (game gone/expired, or a network problem). Show a clear, actionable state.
    if (game.error) {
      return (
        <div className="lobby">
          <div className="lobby__panel">
            <h1 className="lobby__title">Can't open this game</h1>
            <p className="lobby__waiting">{game.error}</p>
            <button className="lobby__start" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
            <button className="lobby__leave" type="button" onClick={onLeave}>
              Back to menu
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="lobby">
        <div className="lobby__panel">
          <h1 className="lobby__title">Connecting…</h1>
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
        onRename={rename}
        onLeave={onLeave}
        startError={startError}
        renameError={renameError}
      />
    );
  }

  return <OnlineGameBoard game={game} onLeave={onLeave} />;
}
