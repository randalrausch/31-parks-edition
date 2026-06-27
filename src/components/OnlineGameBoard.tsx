/**
 * Online game board — viewer-centric perspective (you're always at the bottom),
 * driven by server snapshots. Controls are enabled only on your turn; otherwise
 * a "waiting for {player}" banner shows. No deal animation, AI-thinking view, or
 * pass-the-device cover (the server owns turn flow; each device is one player).
 * Reuses the solo board's CSS classes and leaf components for a consistent look.
 */
import { useEffect, useState } from "react";
import { useTheme } from "./ParkThemeProvider";
import Card from "./Card";
import CardBack from "./CardBack";
import HelpPanel from "./HelpPanel";
import Modal from "./Modal";
import ParkScene from "./ParkScene";
import ParkPicker from "./ParkPicker";
import RoundEndOverlay from "./RoundEndOverlay";
import GameOverOverlay from "./GameOverOverlay";
import { TokenRow } from "./TokenRow";
import LogFeed from "./LogFeed";
import Avatar from "./Avatar";
import { NpsArrowhead } from "../art/Glyphs";
import {
  bestSuit,
  formatScore,
  scoreHand,
  isAlive,
  type GamePlayer,
} from "../game/engine";
import type { NetworkGameApi } from "../game/useNetworkGame";
import "./GameBoard.css";

function Opponent({
  player,
  isKnocker,
  isCurrent,
}: {
  player: GamePlayer;
  isKnocker: boolean;
  isCurrent: boolean;
}) {
  const danger = !player.grace && player.lives === 1;
  return (
    <div
      className={`opp${player.grace ? " opp--grace" : ""}${danger ? " opp--danger" : ""}${
        isCurrent ? " opp--active" : ""
      }`}
    >
      <div className="opp__fan">
        {player.hand.map((_, i) => {
          const mid = (player.hand.length - 1) / 2;
          return (
            <CardBack
              key={i}
              size="sm"
              fanStyle={{
                transform: `rotate(${(i - mid) * 10}deg) translateY(${Math.abs(i - mid) * 2}px)`,
                marginInline: "-10px",
              }}
            />
          );
        })}
      </div>
      <div className="opp__plate">
        <Avatar
          avatarKey={player.avatarKey}
          emoji={player.emoji}
          image={player.image}
          className="avatar--sm"
        />
        <span className="opp__info">
          <span className="opp__name">{player.name}</span>
          <TokenRow lives={player.lives} grace={player.grace} />
        </span>
        {isKnocker && <span className="opp__knock">Knocked</span>}
      </div>
    </div>
  );
}

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
  const topDiscard = s.discard[s.discard.length - 1] ?? null;
  const current = s.players[s.cur];
  const myTurn =
    s.cur === viewer && (s.phase === "drawing" || s.phase === "discarding");
  const canDraw = myTurn && s.phase === "drawing";
  const counting = me ? bestSuit(me.hand) : null;
  const handScore = me ? scoreHand(me.hand, s.options) : 0;
  const roundNo =
    s.dealPlayers > 0
      ? Math.max(1, Math.ceil(s.turnInDeal / s.dealPlayers))
      : 1;

  const turnLabel = myTurn
    ? s.phase === "discarding"
      ? "Your turn · discard a card"
      : "Your turn"
    : `Waiting for ${current?.name ?? "…"}`;

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

        <div className="board__badge">
          <NpsArrowhead className="board__arrowhead" />
          <span className="board__badge-text">
            <span className="board__park">{theme.displayName}</span>
            <span className="board__desig">{theme.designation}</span>
          </span>
        </div>

        <div className="board__topright">
          <span className="board__round">
            <span className="board__round-num">
              Deal {s.dealNum || 1} · Round {roundNo}
            </span>
            <span className="board__round-sub">{aliveCount} Players Left</span>
          </span>
          <button
            className="board__tool"
            type="button"
            onClick={() => setParksOpen(true)}
            aria-label="Switch park"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M3 19l5-9 4 6 3-5 6 8z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="board__tool"
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="How to play"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M9.2 9.3c.2-1.6 1.4-2.6 2.9-2.6 1.6 0 2.8 1 2.8 2.5 0 2.3-2.7 2.2-2.7 4.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="12.1" cy="17" r="1.2" fill="currentColor" />
            </svg>
          </button>
          <button
            className="board__tool"
            type="button"
            onClick={onLeave}
            aria-label="Leave game"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M10 12h11m0 0-3-3m3 3-3 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="board__opponents">
          {opponents.map(({ p, i }) => (
            <Opponent
              key={p.id}
              player={p}
              isKnocker={s.knocker === i}
              isCurrent={s.cur === i}
            />
          ))}
        </div>

        <div className="board__center">
          <div className="piles">
            <div className="piles__stacks">
              <button
                className="piles__deck"
                type="button"
                onClick={() => game.act({ type: "drawDeck" })}
                disabled={!canDraw}
                aria-label="Draw from deck"
              >
                <span className="piles__stack-shadow piles__stack-shadow--3" />
                <span className="piles__stack-shadow piles__stack-shadow--2" />
                {s.deck.length > 0 ? (
                  <CardBack size="md" />
                ) : (
                  <span className="piles__empty">Empty</span>
                )}
                <span className="piles__label">Deck · {s.deck.length}</span>
              </button>
              <button
                className={`piles__discard${topDiscard ? " piles__discard--filled" : ""}`}
                type="button"
                onClick={() => game.act({ type: "takeDiscard" })}
                disabled={!canDraw || !topDiscard}
                aria-label="Take discard"
              >
                {topDiscard ? (
                  <Card card={topDiscard} size="md" />
                ) : (
                  <span className="piles__label">Discard</span>
                )}
                {topDiscard && (
                  <span className="piles__label piles__label--under">
                    Discard
                  </span>
                )}
              </button>
            </div>
            <div className="board__status">{turnLabel}</div>
          </div>
        </div>

        {/* You — always at the bottom */}
        <div className="board__current">
          {me && (
            <>
              <div className="board__you-head">
                <Avatar
                  avatarKey={me.avatarKey}
                  emoji={me.emoji}
                  image={me.image}
                  className="avatar--sm"
                />
                <span className="board__you-name">
                  {me.name}
                  <span className="board__you-turn"> (You)</span>
                </span>
                <TokenRow lives={me.lives} grace={me.grace} />
              </div>

              <div className="board__hand">
                {me.hand.map((c, i) => {
                  const mid = (me.hand.length - 1) / 2;
                  return (
                    <Card
                      key={c.id}
                      card={c}
                      size="lg"
                      interactive={myDiscard}
                      counting={!myDiscard && c.suit === counting}
                      selected={selected === i}
                      onSelect={() =>
                        myDiscard && setSelected(selected === i ? null : i)
                      }
                      fanStyle={{
                        transform: `rotate(${(i - mid) * 4}deg) translateY(${selected === i ? -30 : 0}px)`,
                        marginInline: "-6px",
                        zIndex: selected === i ? 50 : i,
                        opacity:
                          myDiscard && selected !== null && selected !== i
                            ? 0.62
                            : 1,
                        transition: "transform 0.14s ease, opacity 0.14s ease",
                      }}
                    />
                  );
                })}
              </div>

              <div className="board__hud">
                <span className="board__best">
                  Best suit <strong>{formatScore(handScore)}</strong>
                </span>
              </div>

              <div className="board__actions">
                {myDiscard ? (
                  <button
                    className="btn btn--knock board__act-wide"
                    type="button"
                    onClick={() => {
                      if (selected === null) return;
                      game.act({
                        type: "discard",
                        cardId: me.hand[selected].id,
                      });
                      setSelected(null);
                    }}
                    disabled={selected === null}
                  >
                    {selected === null
                      ? "Tap a Card to Discard"
                      : "Discard Selected"}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn--draw"
                      type="button"
                      onClick={() => game.act({ type: "drawDeck" })}
                      disabled={!canDraw}
                    >
                      Draw Deck
                    </button>
                    <button
                      className="btn btn--draw"
                      type="button"
                      onClick={() => game.act({ type: "takeDiscard" })}
                      disabled={!canDraw || !topDiscard}
                    >
                      Take Discard
                    </button>
                    <button
                      className="btn btn--knock"
                      type="button"
                      onClick={() => game.act({ type: "knock" })}
                      disabled={!canDraw || s.knocker !== null}
                    >
                      Knock
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {s.phase === "dealEnd" && (
        <RoundEndOverlay state={s} onNext={game.nextDeal} />
      )}
      {s.phase === "gameOver" && (
        <GameOverOverlay state={s} onNewGame={onLeave} />
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
