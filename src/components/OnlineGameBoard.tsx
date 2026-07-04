/**
 * Online game board — viewer-centric perspective (you're always at the bottom),
 * driven by server snapshots. Controls are enabled only on your turn; otherwise
 * a "waiting for {player}" banner shows. No deal animation, AI-thinking view, or
 * pass-the-device cover (the server owns turn flow; each device is one player).
 * Shares the board's leaf components with the solo board via BoardParts.
 */
import { useEffect, useRef, useState } from "react";
import HelpPanel from "./HelpPanel";
import DealEndOverlay from "./DealEndOverlay";
import GameOverOverlay from "./GameOverOverlay";
import {
  OpponentRow,
  BoardHeader,
  BoardLog,
  ToolButton,
  LeaveIcon,
  Piles,
  PlayerHead,
  TurnControl,
  BoardFrame,
  SwitchParkModal,
} from "./BoardParts";
import {
  bestSuit,
  bestHandScore,
  isAlive,
  roundNo,
  recentLogLimit,
  type GameState,
} from "../game/engine";
import type { NetworkGameApi } from "../game/useNetworkGame";
import { useTurnReplay } from "./useTurnReplay";
import { sndShuffle, sndDeal, sndKnock, sndCoin } from "../game/sound";
import "./GameBoard.css";

export default function OnlineGameBoard({
  game,
  onLeave,
}: {
  game: NetworkGameApi;
  onLeave: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [parksOpen, setParksOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAllLog, setShowAllLog] = useState(false);

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
    if (s && s.phase === "dealEnd" && s.result && s.dealNum !== dismissedDeal.current) {
      setRevealDeal((prev) => (prev && prev.dealNum === s.dealNum ? prev : s));
    }
  }, [s]);

  // Pace opponent (AI/remote) turns: the server settles them atomically, so we
  // replay the new public log moves one beat at a time for natural flow. Match
  // on seat index (not name — names aren't unique) so a same-named opponent's
  // moves are never mistaken for the viewer's own.
  const replay = useTurnReplay(snap, viewer >= 0 ? viewer : null, !!s?.options.sound);

  // Sound cues for the online table (gated by the shared "Sound" house rule):
  // a shuffle when a new deal is dealt and a coin when a deal resolves. Opponent
  // move SFX are paced by useTurnReplay; the viewer's own moves are sounded by
  // the action handlers below. The first snapshot (join / reconnect) only seeds
  // the trackers so we don't retro-play sound for state we arrived into.
  const soundInit = useRef(false);
  const soundedShuffle = useRef(-1);
  const soundedCoin = useRef(-1);
  useEffect(() => {
    if (!s) return;
    if (!soundInit.current) {
      soundInit.current = true;
      soundedShuffle.current = s.dealNum;
      soundedCoin.current = s.phase === "dealEnd" ? s.dealNum : -1;
      return;
    }
    if (!s.options.sound) return;
    if (s.phase !== "dealEnd" && s.dealNum !== soundedShuffle.current) {
      soundedShuffle.current = s.dealNum;
      sndShuffle();
    }
    if (s.phase === "dealEnd" && s.dealNum !== soundedCoin.current) {
      soundedCoin.current = s.dealNum;
      sndCoin();
    }
  }, [s]);

  if (!s) {
    return (
      <BoardFrame>
        <div className="board__connecting">Connecting…</div>
      </BoardFrame>
    );
  }

  // The viewer's own moves are sounded immediately here (opponents are paced by
  // useTurnReplay), gated by the shared house rule.
  const sound = !!s.options.sound;
  const drawDeck = () => {
    if (sound) sndDeal();
    game.act({ type: "drawDeck" });
  };
  const takeDiscard = () => {
    if (sound) sndDeal();
    game.act({ type: "takeDiscard" });
  };
  const knock = () => {
    if (sound) sndKnock();
    game.act({ type: "knock" });
  };

  const me = viewer >= 0 ? s.players[viewer] : null;
  // Order opponents clockwise from THIS player's seat: turn order is ascending
  // seat index (wrapping), so the player who acts next (to your left) shows
  // first and the player just before you shows last — the same table everyone
  // shares, rotated to each viewer's perspective.
  const seatCount = s.players.length;
  const start = viewer >= 0 ? viewer : 0;
  const opponents: { p: (typeof s.players)[number]; i: number }[] = [];
  for (let k = 1; k <= seatCount; k++) {
    const i = (start + k) % seatCount;
    if (i === viewer) continue; // skip yourself
    if (isAlive(s.players[i]!)) opponents.push({ p: s.players[i]!, i });
  }
  const aliveCount = s.players.filter(isAlive).length;
  const current = s.players[s.cur];
  // While opponents are being replayed, lock controls and show the stepped
  // discard pile / acting seat rather than the (already-settled) live values.
  const busy = replay.busy;
  const topDiscard = busy ? replay.discardTop : (s.discard[s.discard.length - 1] ?? null);
  const activeSeat = busy ? replay.actingSeat : s.cur;
  const myTurn = !busy && s.cur === viewer && (s.phase === "drawing" || s.phase === "discarding");
  const canDraw = myTurn && s.phase === "drawing";
  const discarding = myTurn && s.phase === "discarding";
  const counting = me ? bestSuit(me.hand) : null;
  // Best legal 3-card score (mid-draw the hand holds 4 cards; show the best after
  // dropping one, not the illegal 4-card total).
  const handScore = me ? bestHandScore(me.hand, s.options) : 0;

  // The feed normally shows the last full round of moves — up to two entries
  // (draw + discard) per living player, so it scales with the table size
  // instead of clipping mid-round at larger player counts — and when the
  // host's "Full Action History" house rule is on, players may expand it to
  // the whole deal. We still gate by the paced-replay cursor so unrevealed
  // moves stay hidden.
  const RECENT_LOG = recentLogLimit(aliveCount);
  const visibleLog = s.log.filter((e) => e.id <= replay.logThrough);
  const logExpandable = s.options.fullHistory && visibleLog.length > RECENT_LOG;
  const logShowingAll = logExpandable && showAllLog;

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
    <BoardFrame
      overlays={
        <>
          {!game.connected && (
            <div className="board__reconnect" role="status">
              <span className="board__reconnect-dot" aria-hidden="true" />
              Reconnecting…
            </div>
          )}

          {game.actionError && (
            <div className="board__toast" role="alert">
              <span>{game.actionError}</span>
              <button
                type="button"
                className="board__toast-x"
                onClick={game.clearActionError}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {revealDeal ? (
            <DealEndOverlay state={revealDeal} onNext={dismissReveal} />
          ) : (
            s.phase === "gameOver" && (
              <GameOverOverlay state={s} onNewGame={onLeave} ctaLabel="Back to Menu" />
            )
          )}
          <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
          <SwitchParkModal open={parksOpen} onClose={() => setParksOpen(false)} />
        </>
      }
    >
      {/* The action feed is a shared, host-controlled setting — seeing it is
            an advantage, so when the host (seat 0) hides it nobody sees it.
            Only the host gets the toggle; everyone else just follows it. */}
      <BoardLog
        entries={visibleLog}
        recentLimit={RECENT_LOG}
        visible={s.options.showLog !== false}
        canToggle={viewer === 0}
        onToggle={() =>
          game.act({
            type: "setShowLog",
            value: s.options.showLog === false,
          })
        }
        hideLabel="Hide the action log for everyone"
        expandable={logExpandable}
        showingAll={logShowingAll}
        onToggleExpand={() => setShowAllLog((v) => !v)}
        // Small-screen launcher follows the host's shared setting: if the host
        // hid the log, no one — phone or laptop — gets a way to open it.
        available={s.options.showLog !== false}
      />

      <BoardHeader
        dealNum={s.dealNum}
        roundNo={roundNo(s)}
        aliveCount={aliveCount}
        onSwitchPark={() => setParksOpen(true)}
        onHelp={() => setHelpOpen(true)}
        trailing={
          <ToolButton label="Leave game" onClick={onLeave}>
            <LeaveIcon />
          </ToolButton>
        }
      />

      <OpponentRow opponents={opponents} knocker={s.knocker} activeSeat={activeSeat} />

      <Piles
        deckCount={s.deck.length}
        topDiscard={topDiscard}
        canDraw={canDraw}
        onDrawDeck={drawDeck}
        onTakeDiscard={takeDiscard}
        status={
          <div className="board__status" role="status" aria-live="polite">
            {turnLabel}
          </div>
        }
      />

      {/* You — always at the bottom */}
      <div className="board__current">
        {me &&
          (isAlive(me) || s.phase === "gameOver" ? (
            <TurnControl
              player={me}
              turnText=" (You)"
              discarding={discarding}
              counting={counting}
              selected={selected}
              handScore={handScore}
              canDraw={canDraw}
              hasDiscard={!!topDiscard}
              canKnock={canDraw && s.knocker === null}
              onSelect={(i) => discarding && setSelected(selected === i ? null : i)}
              onDrawDeck={drawDeck}
              onTakeDiscard={takeDiscard}
              onKnock={knock}
              onConfirmDiscard={() => {
                if (selected === null) return;
                if (sound) sndDeal();
                game.act({ type: "discard", cardId: me.hand[selected]!.id });
                setSelected(null);
              }}
            />
          ) : (
            // Eliminated but the game's still going — make "you're spectating"
            // explicit instead of an empty hand + dead buttons.
            <div className="board__spectating">
              <PlayerHead player={me} turnText=" (You)" />
              <p className="board__spectating-note">You're out — watching until the game ends.</p>
            </div>
          ))}
      </div>
    </BoardFrame>
  );
}
