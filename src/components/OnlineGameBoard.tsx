/**
 * Online game board — viewer-centric perspective (you're always at the bottom),
 * driven by server snapshots. Controls are enabled only on your turn; otherwise
 * a "waiting for {player}" banner shows. No deal animation, AI-thinking view, or
 * pass-the-device cover (the server owns turn flow; each device is one player).
 * Shares the board's leaf components with the solo board via BoardParts.
 */
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ParkThemeProvider";
import HelpPanel from "./HelpPanel";
import Modal from "./Modal";
import ParkScene from "./ParkScene";
import ParkPicker from "./ParkPicker";
import DealEndOverlay from "./DealEndOverlay";
import GameOverOverlay from "./GameOverOverlay";
import LogFeed from "./LogFeed";
import {
  Opponent,
  BoardBadge,
  BoardWordmark,
  BoardToolbar,
  ToolButton,
  LeaveIcon,
  Piles,
  PlayerHead,
  HandFan,
  HandHud,
  ActionBar,
} from "./BoardParts";
import { bestSuit, scoreHand, isAlive, type GameState } from "../game/engine";
import type { NetworkGameApi } from "../game/useNetworkGame";
import { useTurnReplay } from "./useTurnReplay";
import "./GameBoard.css";

export default function OnlineGameBoard({
  game,
  onLeave,
}: {
  game: NetworkGameApi;
  onLeave: () => void;
}) {
  const { theme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [parksOpen, setParksOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const snap = game.snap;
  const s = snap?.state ?? null;
  const viewer = snap?.seatIndex ?? -1;

  // Reset the local selection whenever it stops being our discard turn.
  const myDiscard = !!s && s.phase === "discarding" && s.cur === viewer;
  useEffect(() => {
    if (!myDiscard && selected !== null) setSelected(null);
  }, [myDiscard, selected]);

  // Capture each deal-end reveal locally so one player clicking "continue"
  // doesn't yank the reveal away from everyone — each player dismisses it in
  // their own time. The first to dismiss advances the shared game; the rest keep
  // viewing the captured reveal and rejoin the live game when they dismiss.
  const [revealDeal, setRevealDeal] = useState<GameState | null>(null);
  const dismissedDeal = useRef(-1);
  useEffect(() => {
    if (
      s &&
      s.phase === "dealEnd" &&
      s.result &&
      s.dealNum !== dismissedDeal.current
    ) {
      setRevealDeal((prev) => (prev && prev.dealNum === s.dealNum ? prev : s));
    }
  }, [s]);

  // Pace opponent (AI/remote) turns: the server settles them atomically, so we
  // replay the new public log moves one beat at a time for natural flow.
  const viewerName =
    s && viewer >= 0 ? (s.players[viewer]?.name ?? null) : null;
  const replay = useTurnReplay(snap, viewerName);

  if (!s) {
    return (
      <section className="board-fold">
        <div className="board paper-grain">
          <ParkScene theme={theme} className="board__scene" />
          <div className="board__vignette" />
          <div className="board__connecting">Connecting…</div>
        </div>
      </section>
    );
  }

  const me = viewer >= 0 ? s.players[viewer] : null;
  const opponents = s.players
    .map((p, i) => ({ p, i }))
    .filter((x) => x.i !== viewer && isAlive(x.p));
  const aliveCount = s.players.filter(isAlive).length;
  const current = s.players[s.cur];
  // While opponents are being replayed, lock controls and show the stepped
  // discard pile / acting seat rather than the (already-settled) live values.
  const busy = replay.busy;
  const topDiscard = busy
    ? replay.discardTop
    : (s.discard[s.discard.length - 1] ?? null);
  const activeSeat = busy ? replay.actingSeat : s.cur;
  const myTurn =
    !busy &&
    s.cur === viewer &&
    (s.phase === "drawing" || s.phase === "discarding");
  const canDraw = myTurn && s.phase === "drawing";
  const discarding = myTurn && s.phase === "discarding";
  const counting = me ? bestSuit(me.hand) : null;
  const handScore = me ? scoreHand(me.hand, s.options) : 0;
  const roundNo =
    s.dealPlayers > 0
      ? Math.max(1, Math.ceil(s.turnInDeal / s.dealPlayers))
      : 1;

  const turnLabel = busy
    ? (replay.note ?? "Playing…")
    : myTurn
      ? s.phase === "discarding"
        ? "Your turn · discard a card"
        : "Your turn"
      : `Waiting for ${current?.name ?? "…"}`;

  // Dismiss this player's reveal; the first to do so advances the shared deal.
  const dismissReveal = () => {
    const r = revealDeal;
    if (!r) return;
    dismissedDeal.current = r.dealNum;
    if (s.phase === "dealEnd" && s.dealNum === r.dealNum) game.nextDeal();
    setRevealDeal(null);
  };

  return (
    <section className="board-fold">
      <div className="board paper-grain">
        <ParkScene theme={theme} className="board__scene" />
        <div className="board__vignette" />

        {s.log.length > 0 && (
          <div className="board__log">
            <span className="board__log-title">At the Table</span>
            <LogFeed entries={s.log} limit={5} />
          </div>
        )}

        <BoardBadge />
        <BoardWordmark />

        <BoardToolbar
          dealNum={s.dealNum}
          roundNo={roundNo}
          aliveCount={aliveCount}
          onSwitchPark={() => setParksOpen(true)}
          onHelp={() => setHelpOpen(true)}
          trailing={
            <ToolButton label="Leave game" onClick={onLeave}>
              <LeaveIcon />
            </ToolButton>
          }
        />

        <div className="board__opponents">
          {opponents.map(({ p, i }) => (
            <Opponent
              key={p.id}
              player={p}
              isKnocker={s.knocker === i}
              isCurrent={activeSeat === i}
            />
          ))}
        </div>

        <Piles
          deckCount={s.deck.length}
          topDiscard={topDiscard}
          canDraw={canDraw}
          onDrawDeck={() => game.act({ type: "drawDeck" })}
          onTakeDiscard={() => game.act({ type: "takeDiscard" })}
          status={<div className="board__status">{turnLabel}</div>}
        />

        {/* You — always at the bottom */}
        <div className="board__current">
          {me && (
            <>
              <PlayerHead player={me} turnText=" (You)" />
              <HandFan
                hand={me.hand}
                interactive={discarding}
                counting={counting}
                selected={selected}
                onSelect={(i) =>
                  discarding && setSelected(selected === i ? null : i)
                }
              />
              <HandHud score={handScore} />
              <ActionBar
                discarding={discarding}
                canDraw={canDraw}
                hasDiscard={!!topDiscard}
                canKnock={canDraw && s.knocker === null}
                discardSelected={selected !== null}
                onDrawDeck={() => game.act({ type: "drawDeck" })}
                onTakeDiscard={() => game.act({ type: "takeDiscard" })}
                onKnock={() => game.act({ type: "knock" })}
                onConfirmDiscard={() => {
                  if (selected === null) return;
                  game.act({ type: "discard", cardId: me.hand[selected].id });
                  setSelected(null);
                }}
              />
            </>
          )}
        </div>
      </div>

      {revealDeal ? (
        <DealEndOverlay state={revealDeal} onNext={dismissReveal} />
      ) : (
        s.phase === "gameOver" && (
          <GameOverOverlay state={s} onNewGame={onLeave} />
        )
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
