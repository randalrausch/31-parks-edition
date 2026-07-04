/**
 * The immersive, perspective-correct game table (solo + pass-and-play).
 *
 * Hidden information is enforced here: only the current player's hand is shown
 * face-up (and only their score); every opponent is face-down with tokens but
 * NO score. There are no community cards — just the deck and the discard.
 * The seating row adapts to however many players are configured. Shared board
 * pieces live in BoardParts; this file owns the solo-only bits (AI "thinking"
 * view, pass-the-device cover, deal/game-over overlays).
 */
import { useEffect, useState } from "react";
import CardBack from "./CardBack";
import HelpPanel from "./HelpPanel";
import CoverScreen from "./CoverScreen";
import DealEndOverlay from "./DealEndOverlay";
import GameOverOverlay from "./GameOverOverlay";
import Avatar from "./Avatar";
import {
  OpponentRow,
  BoardHeader,
  BoardLog,
  ToolButton,
  NewGameIcon,
  Piles,
  TurnControl,
  BoardFrame,
  SwitchParkModal,
} from "./BoardParts";
import { bestSuit, bestHandScore, isAlive, roundNo, type GameState } from "../game/engine";
import type { SoloGameApi } from "../game/useGame";
import { clearSoloResuming } from "../game/soloPersist";
import "./GameBoard.css";

export default function GameBoard({ game }: { game: SoloGameApi }) {
  // Reaching a mounted board means a resumed save rendered without crashing, so
  // clear the resume guard (a save that DID crash never gets here, so its guard
  // survives the reload and the next resume discards it). No-op for fresh games.
  useEffect(() => {
    clearSoloResuming();
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [parksOpen, setParksOpen] = useState(false);
  // Whether the live action feed is shown on the table. Defaults to on, and
  // the choice is remembered across turns and games.
  const [logOpen, setLogOpen] = useState(() => {
    try {
      return localStorage.getItem("parks31.log") !== "0";
    } catch {
      return true;
    }
  });
  const toggleLog = () =>
    setLogOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("parks31.log", next ? "1" : "0");
      } catch {
        /* storage unavailable — keep the in-memory choice */
      }
      return next;
    });
  // Whether the on-table feed is expanded to the whole deal (only offered when
  // the "Full Action History" house rule is on — matches the online board).
  const [showAllLog, setShowAllLog] = useState(false);
  const s = game.state;
  if (!s) return null;

  const cur = s.players[s.cur]!; // the current seat is always in-bounds
  // Seat only living opponents (eliminated players leave the table).
  const opponents = s.players
    .map((p, i) => ({ p, i }))
    .filter((x) => x.i !== s.cur && isAlive(x.p));
  const aliveCount = s.players.filter(isAlive).length;
  const topDiscard = s.discard[s.discard.length - 1] ?? null;
  // The on-table feed shows the last full round (up to two entries per living
  // player). With the "Full Action History" house rule on, let the player
  // expand it to the whole deal — the same affordance the online board offers.
  const recentLog = aliveCount * 2;
  const logExpandable = s.options.fullHistory && s.log.length > recentLog;

  const isHumanTurn = !cur.isAI && (s.phase === "drawing" || s.phase === "discarding");
  const canDraw = !cur.isAI && s.phase === "drawing";
  const discarding = s.phase === "discarding";
  const counting = bestSuit(cur.hand);
  // Best score for a legal 3-card hand — during the discard phase the hand holds
  // 4 cards, so show the best achievable after dropping one, not the 4-card total.
  const handScore = bestHandScore(cur.hand, s.options);

  return (
    <BoardFrame
      overlays={
        <>
          {s.phase === "cover" && (
            <CoverScreen
              name={cur.name}
              avatarKey={cur.avatarKey}
              log={s.log}
              allowFullHistory={s.options.fullHistory}
              onReady={game.coverReady}
            />
          )}
          {s.phase === "dealEnd" && (
            <DealEndOverlay state={s as GameState} onNext={game.nextDeal} />
          )}
          {s.phase === "gameOver" && (
            <GameOverOverlay state={s as GameState} onNewGame={game.newGame} />
          )}
          <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
          <SwitchParkModal open={parksOpen} onClose={() => setParksOpen(false)} />
        </>
      }
    >
      {/* Live public-action feed (what everyone at the table can see).
            Optional — players can hide it; the choice is remembered. Shows a
            full round (up to two entries per living player: draw + discard). */}
      <BoardLog
        entries={s.log}
        recentLimit={recentLog}
        visible={logOpen}
        canToggle
        onToggle={toggleLog}
        hideWhenEmpty
        expandable={logExpandable}
        showingAll={logExpandable && showAllLog}
        onToggleExpand={() => setShowAllLog((v) => !v)}
      />

      <BoardHeader
        dealNum={s.dealNum}
        roundNo={roundNo(s)}
        aliveCount={aliveCount}
        onSwitchPark={() => setParksOpen(true)}
        onHelp={() => setHelpOpen(true)}
        trailing={
          <ToolButton label="New game" onClick={game.newGame}>
            <NewGameIcon />
          </ToolButton>
        }
      />

      <OpponentRow opponents={opponents} knocker={s.knocker} />

      <Piles
        deckCount={s.deck.length}
        topDiscard={topDiscard}
        canDraw={canDraw}
        onDrawDeck={game.drawDeck}
        onTakeDiscard={game.drawDiscard}
        status={
          s.status ? (
            <div className="board__status" role="status" aria-live="polite">
              {s.status}
            </div>
          ) : null
        }
      />

      {/* Current player */}
      <div className="board__current">
        {cur.isAI ? (
          <div className="board__ai">
            <Avatar avatarKey={cur.avatarKey} emoji={cur.emoji} image={cur.image} />
            <span className="board__ai-name">{cur.name}</span>
            <span className="board__ai-think">is thinking…</span>
            <div className="board__ai-cards">
              {cur.hand.map((c) => (
                <CardBack key={c.id} size="sm" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <TurnControl
              player={cur}
              turnText={discarding ? " · discard a card" : "'s turn"}
              discarding={discarding}
              counting={counting}
              selected={s.selected}
              handScore={handScore}
              canDraw={canDraw}
              hasDiscard={!!topDiscard}
              canKnock={canDraw && s.knocker === null}
              onSelect={game.selectCard}
              onDrawDeck={game.drawDeck}
              onTakeDiscard={game.drawDiscard}
              onKnock={game.knock}
              onConfirmDiscard={game.confirmDiscard}
            />
            {!isHumanTurn && !discarding && <div className="board__wait">Waiting…</div>}
          </>
        )}
      </div>
    </BoardFrame>
  );
}
