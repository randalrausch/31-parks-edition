/**
 * The immersive, perspective-correct game table.
 *
 * Hidden information is enforced here: only the current player's hand is shown
 * face-up (and only their score); every opponent is face-down with tokens but
 * NO score. There are no community cards — just the deck and the discard.
 * The seating row adapts to however many players are configured.
 */
import { useTheme } from "./ParkThemeProvider";
import Card from "./Card";
import CardBack from "./CardBack";
import HelpPanel from "./HelpPanel";
import Modal from "./Modal";
import ParkScene from "./ParkScene";
import ParkPicker from "./ParkPicker";
import CoverScreen from "./CoverScreen";
import DealEndOverlay from "./DealEndOverlay";
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
  type GameState,
} from "../game/engine";
import type { SoloGameApi } from "../game/useGame";
import { useState } from "react";
import "./GameBoard.css";

/** A face-down opponent — name, tokens, fanned backs. Never a score. */
function Opponent({
  player,
  isKnocker,
}: {
  player: GamePlayer;
  isKnocker: boolean;
}) {
  const danger = !player.grace && player.tokens === 1;
  return (
    <div
      className={`opp${player.grace ? " opp--grace" : ""}${danger ? " opp--danger" : ""}`}
    >
      <div className="opp__fan">
        {player.hand.map((c, i) => {
          const mid = (player.hand.length - 1) / 2;
          return (
            <CardBack
              key={c.id}
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
          <TokenRow tokens={player.tokens} grace={player.grace} />
        </span>
        {isKnocker && <span className="opp__knock">Knocked</span>}
      </div>
    </div>
  );
}

export default function GameBoard({ game }: { game: SoloGameApi }) {
  const { theme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [parksOpen, setParksOpen] = useState(false);
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
  const counting = bestSuit(cur.hand);
  const handScore = scoreHand(cur.hand, s.options);
  // Round (lap of the table) within the current deal.
  const roundNo =
    s.dealPlayers > 0
      ? Math.max(1, Math.ceil(s.turnInDeal / s.dealPlayers))
      : 1;

  return (
    <section className="board-fold">
      <div className="board paper-grain">
        <ParkScene theme={theme} className="board__scene" />
        <div className="board__vignette" />

        {/* Live public-action feed (what everyone at the table can see) */}
        {s.log.length > 0 && (
          <div className="board__log">
            <span className="board__log-title">At the Table</span>
            <LogFeed entries={s.log} limit={5} />
          </div>
        )}

        {/* Park badge */}
        <div className="board__badge">
          <NpsArrowhead className="board__arrowhead" />
          <span className="board__badge-text">
            <span className="board__park">{theme.displayName}</span>
            <span className="board__desig">{theme.designation}</span>
          </span>
        </div>

        {/* Round info + tools */}
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
            onClick={game.newGame}
            aria-label="New game"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 5h14v14H5z M9 9l6 6 M15 9l-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Opponents */}
        <div className="board__opponents">
          {opponents.map(({ p, i }) => (
            <Opponent key={p.id} player={p} isKnocker={s.knocker === i} />
          ))}
        </div>

        {/* Center: deck + discard */}
        <div className="board__center">
          <div className="piles">
            <div className="piles__stacks">
              <button
                className="piles__deck"
                type="button"
                onClick={game.drawDeck}
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
                onClick={game.drawDiscard}
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
            {s.status && <div className="board__status">{s.status}</div>}
          </div>
        </div>

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
              <div className="board__you-head">
                <Avatar
                  avatarKey={cur.avatarKey}
                  emoji={cur.emoji}
                  image={cur.image}
                  className="avatar--sm"
                />
                <span className="board__you-name">
                  {cur.name}
                  <span className="board__you-turn">
                    {s.phase === "discarding" ? " · discard a card" : "'s turn"}
                  </span>
                </span>
                <TokenRow tokens={cur.tokens} grace={cur.grace} />
              </div>

              <div className="board__hand">
                {cur.hand.map((c, i) => {
                  const mid = (cur.hand.length - 1) / 2;
                  return (
                    <Card
                      key={c.id}
                      card={c}
                      size="lg"
                      interactive={s.phase === "discarding"}
                      // Suppress the counting-suit highlight while discarding so the
                      // only emphasized card is the one chosen to discard.
                      counting={s.phase !== "discarding" && c.suit === counting}
                      selected={s.selected === i}
                      onSelect={() => game.selectCard(i)}
                      fanStyle={{
                        transform: `rotate(${(i - mid) * 4}deg) translateY(${
                          s.selected === i ? -30 : 0
                        }px)`,
                        marginInline: "-6px",
                        zIndex: s.selected === i ? 50 : i,
                        opacity:
                          s.phase === "discarding" &&
                          s.selected !== null &&
                          s.selected !== i
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
                {s.phase === "discarding" ? (
                  <button
                    className="btn btn--knock board__act-wide"
                    type="button"
                    onClick={game.confirmDiscard}
                    disabled={s.selected === null}
                  >
                    {s.selected === null
                      ? "Tap a Card to Discard"
                      : "Discard Selected"}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn--draw"
                      type="button"
                      onClick={game.drawDeck}
                      disabled={!canDraw}
                    >
                      Draw Deck
                    </button>
                    <button
                      className="btn btn--draw"
                      type="button"
                      onClick={game.drawDiscard}
                      disabled={!canDraw || !topDiscard}
                    >
                      Take Discard
                    </button>
                    <button
                      className="btn btn--knock"
                      type="button"
                      onClick={game.knock}
                      disabled={!canDraw || s.knocker !== null}
                    >
                      Knock
                    </button>
                  </>
                )}
              </div>
              {!isHumanTurn && s.phase !== "discarding" && (
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
