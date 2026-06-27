/**
 * 31 · National Parks Edition — app shell.
 *
 * Flow: SetupScreen (pick park, players, rules) → GameBoard (play). The board
 * owns the in-game overlays (pass-the-device cover, round-end reveal, game
 * over). State lives in the useGame hook so it survives screen switches.
 *
 * TODO(multiplayer): the game already runs on a pure engine behind useGame.
 * A networked transport would feed/return the same GameState so each human can
 * play from their own device.
 */
import { useEffect, useState } from "react";
import { ParkThemeProvider } from "./components/ParkThemeProvider";
import SetupScreen from "./components/SetupScreen";
import GameBoard from "./components/GameBoard";
import JoinModal from "./components/JoinModal";
import OnlineGame, { type OnlineSession } from "./components/OnlineGame";
import { useGame } from "./game/useGame";
import { gameApi } from "./game/supabaseClient";
import { AI_CHARACTERS } from "./game/aiCharacters";
import "./App.css";

function Shell() {
  const game = useGame();
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  // DEV: #demo auto-starts a sample game (for screenshots). Harmless deep-link.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hash === "#demo" &&
      !game.state
    ) {
      game.startGame({
        players: [
          { name: "You", isAI: false, avatarKey: "ranger" },
          ...AI_CHARACTERS.slice(0, 3).map((c) => ({
            name: c.name,
            isAI: true,
            avatarKey: "ranger",
            emoji: c.emoji,
            traits: c.traits,
          })),
        ],
        options: {
          threeOfAKind: false,
          grace: true,
          knockPenalty: false,
          sound: false,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (session) {
    return <OnlineGame session={session} onLeave={() => setSession(null)} />;
  }
  if (game.state) {
    return <GameBoard game={game} />;
  }
  return (
    <>
      <SetupScreen
        onStart={game.startGame}
        onCreateOnline={async (config) => {
          if (!gameApi) return;
          try {
            const r = await gameApi.create(config);
            setSession({
              gameId: r.gameId,
              seatToken: r.seatToken,
              code: r.code,
              seatIndex: r.seatIndex,
            });
          } catch (e) {
            console.error("create online failed", e);
          }
        }}
        onJoinOnline={() => setJoinOpen(true)}
      />
      <JoinModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(s) => {
          setJoinOpen(false);
          setSession(s);
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ParkThemeProvider>
      <Shell />
    </ParkThemeProvider>
  );
}
