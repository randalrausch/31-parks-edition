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
import { useState } from "react";
import { useTheme } from "./ParkThemeProvider";
import CardBack from "./CardBack";
import HelpPanel from "./HelpPanel";
import Modal from "./Modal";
import ParkScene from "./ParkScene";
import ParkPicker from "./ParkPicker";
import CoverScreen from "./CoverScreen";
import DealEndOverlay from "./DealEndOverlay";
import GameOverOverlay from "./GameOverOverlay";
import Avatar from "./Avatar";
import {
  Opponent,
  BoardBadge,
  BoardWordmark,
  BoardToolbar,
  BoardLog,
  ToolButton,
  NewGameIcon,
  Piles,
  PlayerHead,
  HandFan,
  HandHud,
  ActionBar,
} from "./BoardParts";
import {
  bestSuit,
  scoreHand,
  isAlive,
  roundNo,
  type GameState,
} from "../game/engine";
import type { SoloGameApi } from "../game/useGame";
import "./GameBoard.css";

export default function GameBoard({ game }: { game: SoloGameApi }) {
  const { theme } = useTheme();
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
  const s = game.state;
  if (!s) return null;

  const cur = s.players[s.cur];
  // Seat only living opponents (eliminated players leave the table).
  const opponents = s.players
    .map((p, i) => ({ p, i }))
    .filter((x) => x.i !== s.cur && isAlive(x.p));
  const aliveCount = s.players.filter(isAlive).length;
  const topDiscard = s.discard[s.discard.length - 1] ?? null;

  const isHumanTurn =
    !cur.isAI && (s.phase === "drawing" || s.phase === "discarding");
  const canDraw = !cur.isAI && s.phase === "drawing";
  const discarding = s.phase === "discarding";
  const counting = bestSuit(cur.hand);
  const handScore = scoreHand(cur.hand, s.options);

  return (
    <section className="board-fold">
      <div className="board paper-grain">
        <ParkScene theme={theme} className="board__scene" />
        <div className="board__vignette" />

        {/* Live public-action feed (what everyone at the table can see).
            Optional — players can hide it; the choice is remembered. */}
        <BoardLog
          entries={s.log}
          recentLimit={5}
          visible={logOpen}
          canToggle
          onToggle={toggleLog}
          hideWhenEmpty
        />

        <BoardBadge />
        <BoardWordmark />

        <BoardToolbar
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

        <div className="board__opponents">
          {opponents.map(({ p, i }) => (
            <Opponent key={p.id} player={p} isKnocker={s.knocker === i} />
          ))}
        </div>

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
              <Avatar
                avatarKey={cur.avatarKey}
                emoji={cur.emoji}
                image={cur.image}
              />
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
              <PlayerHead
                player={cur}
                turnText={discarding ? " · discard a card" : "'s turn"}
              />
              <HandFan
                hand={cur.hand}
                interactive={discarding}
                counting={counting}
                selected={s.selected}
                onSelect={game.selectCard}
              />
              <HandHud score={handScore} />
              <ActionBar
                discarding={discarding}
                canDraw={canDraw}
                hasDiscard={!!topDiscard}
                canKnock={canDraw && s.knocker === null}
                discardSelected={s.selected !== null}
                onDrawDeck={game.drawDeck}
                onTakeDiscard={game.drawDiscard}
                onKnock={game.knock}
                onConfirmDiscard={game.confirmDiscard}
              />
              {!isHumanTurn && !discarding && (
                <div className="board__wait">Waiting…</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Overlays */}
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
      <Modal
        open={parksOpen}
        onClose={() => setParksOpen(false)}
        labelledBy="parks-title"
      >
        <h2 id="parks-title" className="board__modal-title">
          Switch Park
        </h2>
        <ParkPicker heading={false} onPick={() => setParksOpen(false)} />
      </Modal>
    </section>
  );
}
