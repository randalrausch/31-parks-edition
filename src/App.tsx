/**
 * 31 · National Parks Edition — app shell.
 *
 * Solo: SetupScreen → GameBoard (via useGame). Online: a lazily-loaded
 * OnlineRoot holds everything that needs Supabase, so the common solo path
 * never downloads the SDK. A saved session resumes online play after a refresh.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { ParkThemeProvider } from "./components/ParkThemeProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupScreen from "./components/SetupScreen";
import GameBoard from "./components/GameBoard";
import { useGame } from "./game/useGame";
import { AI_CHARACTERS } from "./game/aiCharacters";
import { loadSession } from "./game/onlineSession";
import type { CreateConfig } from "./game/gameApi";
import type { OnlineIntent } from "./components/OnlineRoot";
import "./App.css";

const OnlineRoot = lazy(() => import("./components/OnlineRoot"));

function Shell() {
  const game = useGame();
  const [intent, setIntent] = useState<OnlineIntent | null>(null);

  // DEV: #demo auto-starts a sample solo game (for screenshots).
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#demo" && !game.state) {
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
          showLog: true,
          fullHistory: false,
        },
      });
      return;
    }
    // Resume a saved online session after a page refresh; an online session
    // takes precedence over a solo save so exiting online lands on the home
    // screen, not an old solo game.
    const saved = loadSession();
    if (saved) {
      setIntent({ type: "resume", session: saved });
      return;
    }
    // Otherwise resume an in-progress solo/pass-and-play game if one was saved.
    game.resumeSolo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (intent) {
    return (
      <Suspense fallback={<OnlineFallback />}>
        <OnlineRoot intent={intent} onExit={() => setIntent(null)} />
      </Suspense>
    );
  }
  if (game.state) {
    return <GameBoard game={game} />;
  }
  return (
    <SetupScreen
      onStart={game.startGame}
      onCreateOnline={(config: CreateConfig) => setIntent({ type: "create", config })}
      onJoinOnline={() => setIntent({ type: "join" })}
    />
  );
}

function OnlineFallback() {
  return (
    <div className="lobby">
      <div className="lobby__panel">
        <h1 className="lobby__title">Loading…</h1>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ParkThemeProvider>
        <Shell />
      </ParkThemeProvider>
    </ErrorBoundary>
  );
}
