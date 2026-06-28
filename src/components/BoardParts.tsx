/**
 * Shared building blocks for the two game boards (solo GameBoard and online
 * OnlineGameBoard). Both render the same table — opponents, park badge, toolbar,
 * deck/discard piles, the local player's hand, HUD, and action buttons — so that
 * structure lives here once. The boards differ only in how state arrives
 * (in-process reducer vs. server snapshots) and how actions are dispatched, so
 * these parts take plain data + callbacks and stay presentation-only.
 */
import type { ReactNode } from "react";
import Card from "./Card";
import CardBack from "./CardBack";
import Avatar from "./Avatar";
import { TokenRow } from "./TokenRow";
import { NpsArrowhead } from "../art/Glyphs";
import { useTheme } from "./ParkThemeProvider";
import { formatScore, type GamePlayer } from "../game/engine";
import type { CardModel, Suit } from "../types";

/** A face-down opponent — name, tokens, fanned backs. Never a score. */
export function Opponent({
  player,
  isKnocker,
  isCurrent = false,
}: {
  player: GamePlayer;
  isKnocker: boolean;
  /** Highlight the seat whose turn it is (used online, where there's no AI view). */
  isCurrent?: boolean;
}) {
  const danger = !player.grace && player.tokens === 1;
  const cls = [
    "opp",
    player.grace && "opp--grace",
    danger && "opp--danger",
    isCurrent && "opp--active",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className="opp__fan">
        {player.hand.map((_, i) => {
          // Key by index: hidden opponent cards all share the same id.
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
          <TokenRow tokens={player.tokens} grace={player.grace} />
        </span>
        {isKnocker && <span className="opp__knock">Knocked</span>}
      </div>
    </div>
  );
}

/** Top-left park identity badge (reads the active theme). */
export function BoardBadge() {
  const { theme } = useTheme();
  return (
    <div className="board__badge">
      <NpsArrowhead className="board__arrowhead" />
      <span className="board__badge-text">
        <span className="board__park">{theme.displayName}</span>
        <span className="board__desig">{theme.designation}</span>
      </span>
    </div>
  );
}

/* ── Toolbar icons ── */
const PickParkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 19l5-9 4 6 3-5 6 8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);
const HelpIcon = () => (
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
);
export const NewGameIcon = () => (
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
);
export const LeaveIcon = () => (
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
);

/** A toolbar icon button (consistent styling for the board's top-right tools). */
export function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="board__tool"
      type="button"
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/** Top-right HUD: deal/round counter + tool buttons. `trailing` is the board-
 * specific final button (new-game for solo, leave for online). */
export function BoardToolbar({
  dealNum,
  roundNo,
  aliveCount,
  onSwitchPark,
  onHelp,
  trailing,
}: {
  dealNum: number;
  roundNo: number;
  aliveCount: number;
  onSwitchPark: () => void;
  onHelp: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="board__topright">
      <span className="board__round">
        <span className="board__round-num">
          Deal {dealNum || 1} · Round {roundNo}
        </span>
        <span className="board__round-sub">{aliveCount} Players Left</span>
      </span>
      <ToolButton label="Switch park" onClick={onSwitchPark}>
        <PickParkIcon />
      </ToolButton>
      <ToolButton label="How to play" onClick={onHelp}>
        <HelpIcon />
      </ToolButton>
      {trailing}
    </div>
  );
}

/** Center deck + discard piles. `status` is the line shown beneath them. */
export function Piles({
  deckCount,
  topDiscard,
  canDraw,
  onDrawDeck,
  onTakeDiscard,
  status,
}: {
  deckCount: number;
  topDiscard: CardModel | null;
  canDraw: boolean;
  onDrawDeck: () => void;
  onTakeDiscard: () => void;
  status: ReactNode;
}) {
  return (
    <div className="board__center">
      <div className="piles">
        <div className="piles__stacks">
          <button
            className="piles__deck"
            type="button"
            onClick={onDrawDeck}
            disabled={!canDraw}
            aria-label="Draw from deck"
          >
            <span className="piles__stack-shadow piles__stack-shadow--3" />
            <span className="piles__stack-shadow piles__stack-shadow--2" />
            {deckCount > 0 ? (
              <CardBack size="md" />
            ) : (
              <span className="piles__empty">Empty</span>
            )}
            <span className="piles__label">Deck · {deckCount}</span>
          </button>
          <button
            className={`piles__discard${topDiscard ? " piles__discard--filled" : ""}`}
            type="button"
            onClick={onTakeDiscard}
            disabled={!canDraw || !topDiscard}
            aria-label="Take discard"
          >
            {topDiscard ? (
              // Key by id so a new top card remounts and plays the land-in
              // animation (see .piles__discard .card in GameBoard.css).
              <Card key={topDiscard.id} card={topDiscard} size="md" />
            ) : (
              <span className="piles__label">Discard</span>
            )}
            {topDiscard && (
              <span className="piles__label piles__label--under">Discard</span>
            )}
          </button>
        </div>
        {status}
      </div>
    </div>
  );
}

/** The local player's head: avatar, name + turn label, and tokens. */
export function PlayerHead({
  player,
  turnText,
}: {
  player: GamePlayer;
  turnText: string;
}) {
  return (
    <div className="board__you-head">
      <Avatar
        avatarKey={player.avatarKey}
        emoji={player.emoji}
        image={player.image}
        className="avatar--sm"
      />
      <span className="board__you-name">
        {player.name}
        <span className="board__you-turn">{turnText}</span>
      </span>
      <TokenRow tokens={player.tokens} grace={player.grace} />
    </div>
  );
}

/** The local player's interactive, fanned hand. */
export function HandFan({
  hand,
  interactive,
  counting,
  selected,
  onSelect,
}: {
  hand: CardModel[];
  /** True only while discarding — enables selection and dims unpicked cards. */
  interactive: boolean;
  counting: Suit | null;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="board__hand">
      {hand.map((c, i) => {
        const mid = (hand.length - 1) / 2;
        return (
          <Card
            key={c.id}
            card={c}
            size="lg"
            interactive={interactive}
            // Suppress the counting-suit highlight while discarding so the only
            // emphasized card is the one chosen to discard.
            counting={!interactive && c.suit === counting}
            selected={selected === i}
            onSelect={() => onSelect(i)}
            fanStyle={{
              transform: `rotate(${(i - mid) * 4}deg) translateY(${selected === i ? -30 : 0}px)`,
              marginInline: "-6px",
              zIndex: selected === i ? 50 : i,
              opacity:
                interactive && selected !== null && selected !== i ? 0.62 : 1,
              transition: "transform 0.14s ease, opacity 0.14s ease",
            }}
          />
        );
      })}
    </div>
  );
}

/** "Best suit {score}" readout under the hand. */
export function HandHud({ score }: { score: number }) {
  return (
    <div className="board__hud">
      <span className="board__best">
        Best suit <strong>{formatScore(score)}</strong>
      </span>
    </div>
  );
}

/** Draw/Take/Knock buttons, or the single Discard button while discarding. */
export function ActionBar({
  discarding,
  canDraw,
  hasDiscard,
  canKnock,
  discardSelected,
  onDrawDeck,
  onTakeDiscard,
  onKnock,
  onConfirmDiscard,
}: {
  discarding: boolean;
  canDraw: boolean;
  hasDiscard: boolean;
  canKnock: boolean;
  discardSelected: boolean;
  onDrawDeck: () => void;
  onTakeDiscard: () => void;
  onKnock: () => void;
  onConfirmDiscard: () => void;
}) {
  return (
    <div className="board__actions">
      {discarding ? (
        <button
          className="btn btn--knock board__act-wide"
          type="button"
          onClick={onConfirmDiscard}
          disabled={!discardSelected}
        >
          {discardSelected ? "Discard Selected" : "Tap a Card to Discard"}
        </button>
      ) : (
        <>
          <button
            className="btn btn--draw"
            type="button"
            onClick={onDrawDeck}
            disabled={!canDraw}
          >
            Draw Deck
          </button>
          <button
            className="btn btn--draw"
            type="button"
            onClick={onTakeDiscard}
            disabled={!canDraw || !hasDiscard}
          >
            Take Discard
          </button>
          <button
            className="btn btn--knock"
            type="button"
            onClick={onKnock}
            disabled={!canKnock}
          >
            Knock
          </button>
        </>
      )}
    </div>
  );
}
