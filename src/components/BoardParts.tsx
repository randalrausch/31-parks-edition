/**
 * Shared building blocks for the two game boards (solo GameBoard and online
 * OnlineGameBoard). Both render the same table — opponents, park badge, toolbar,
 * deck/discard piles, the local player's hand, HUD, and action buttons — so that
 * structure lives here once. The boards differ only in how state arrives
 * (in-process reducer vs. server snapshots) and how actions are dispatched, so
 * these parts take plain data + callbacks and stay presentation-only.
 */
import { useState, type ReactNode } from "react";
import Card from "./Card";
import CardBack from "./CardBack";
import Avatar from "./Avatar";
import LogFeed from "./LogFeed";
import { TokenRow } from "./TokenRow";
import { NpsArrowhead } from "../art/Glyphs";
import { useTheme } from "./ParkThemeProvider";
import ParkScene from "./ParkScene";
import Modal from "./Modal";
import ParkPicker from "./ParkPicker";
import { formatScore, type GamePlayer, type LogEntry } from "../game/engine";
import type { CardModel, Suit } from "../types";

/**
 * The board's immersive frame — the perspective-correct table surface, park
 * scene, and vignette — shared by both boards (and the online "Connecting…"
 * state) so the scaffolding can't drift. `children` are the table contents;
 * `overlays` render as siblings of the table inside the fold (covers, deal-end /
 * game-over overlays, toasts, modals).
 */
export function BoardFrame({ children, overlays }: { children: ReactNode; overlays?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <section className="board-fold">
      <div className="board paper-grain">
        <ParkScene theme={theme} className="board__scene" />
        <div className="board__vignette" />
        {children}
      </div>
      {overlays}
    </section>
  );
}

/** The "Switch Park" modal, identical on both boards. */
export function SwitchParkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="parks-title">
      <h2 id="parks-title" className="board__modal-title">
        Switch Park
      </h2>
      <ParkPicker heading={false} onPick={onClose} />
    </Modal>
  );
}

/**
 * The inner "At the Table" content — heading (with optional Hide toggle), the
 * feed itself, and the optional full-deal-history expander. Shared by the desktop
 * docked panel and the mobile drawer so the two presentations can never drift.
 * `heading` lets the drawer supply its own title styling.
 */
function LogPanelBody({
  entries,
  recentLimit,
  canToggle,
  onToggle,
  hideLabel,
  expandable,
  showingAll,
  onToggleExpand,
  titleId,
}: {
  entries: LogEntry[];
  recentLimit: number;
  canToggle: boolean;
  onToggle: () => void;
  hideLabel: string;
  expandable: boolean;
  showingAll: boolean;
  onToggleExpand?: () => void;
  /** When the feed labels a dialog (the mobile drawer), the title carries the id
   * the dialog's aria-labelledby points at. */
  titleId?: string;
}) {
  return (
    <>
      <div className="board__log-head">
        <span className="board__log-title" id={titleId}>
          At the Table
        </span>
        {canToggle && (
          <button
            type="button"
            className="board__log-toggle"
            onClick={onToggle}
            aria-label={hideLabel}
          >
            Hide
          </button>
        )}
      </div>
      <LogFeed entries={entries} limit={showingAll ? undefined : recentLimit} newestFirst />
      {expandable && (
        <button
          type="button"
          className="board__log-more"
          onClick={onToggleExpand}
          aria-expanded={showingAll}
        >
          {showingAll ? "Show recent only" : `Show full deal history (${entries.length})`}
        </button>
      )}
    </>
  );
}

/**
 * The "At the Table" action feed, shared by both boards so the panel shell can't
 * drift between them. The boards differ only in how visibility is controlled
 * (solo: a remembered local toggle; online: a host-gated, shared setting) and
 * whether the whole-deal history can be expanded — all passed in as props.
 *
 * Two presentations, one content: a docked side panel on wide screens, and a
 * tap-to-open left drawer on small screens (where the dock has nowhere to live).
 * `available` gates the small-screen launcher — seeing the feed is a competitive
 * advantage, so online passes the host's shared setting here (host-hidden = no
 * launcher for anyone), while solo passes `true` (it's your own game, always
 * peekable) independent of the dock's remembered show/hide preference.
 */
export function BoardLog({
  entries,
  recentLimit,
  visible,
  canToggle,
  onToggle,
  hideLabel = "Hide the action log",
  expandable = false,
  showingAll = false,
  onToggleExpand,
  hideWhenEmpty = false,
  available = true,
}: {
  entries: LogEntry[];
  /** How many recent moves to show when not expanded. */
  recentLimit: number;
  /** Whether the docked feed is currently shown (desktop presentation). */
  visible: boolean;
  /** Whether this viewer may show/hide the feed. */
  canToggle: boolean;
  onToggle: () => void;
  hideLabel?: string;
  /** Whether a "show full deal history" affordance is offered. */
  expandable?: boolean;
  showingAll?: boolean;
  onToggleExpand?: () => void;
  /** Solo: render nothing at all until there's something to show. */
  hideWhenEmpty?: boolean;
  /** Whether this viewer is permitted to see the feed at all — drives the
   * small-screen launcher (solo: always; online: the host's shared setting). */
  available?: boolean;
}) {
  // Small-screen drawer state: an ephemeral, on-demand overlay (no persistence —
  // it isn't a dock preference, just "show me the feed right now").
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (hideWhenEmpty && entries.length === 0) return null;

  const body = (titleId?: string) => (
    <LogPanelBody
      entries={entries}
      recentLimit={recentLimit}
      canToggle={canToggle}
      onToggle={onToggle}
      hideLabel={hideLabel}
      expandable={expandable}
      showingAll={showingAll}
      onToggleExpand={onToggleExpand}
      titleId={titleId}
    />
  );

  return (
    <>
      {/* Desktop: the docked side panel (or the "Show log" pill when hidden).
          Both are display:none on small screens — the pill launcher below takes
          over there. */}
      {visible ? (
        entries.length > 0 && <div className="board__log">{body()}</div>
      ) : canToggle ? (
        <button type="button" className="board__log-show" onClick={onToggle}>
          Show log
        </button>
      ) : null}

      {/* Small screens: a floating pill at the table's left edge. When the feed
          is available it opens the same content as a left drawer; gated by
          `available` so the online host's hide setting still hides it from
          everyone. When it's hidden, only a viewer who may toggle (the host) sees
          a "Show log" pill to bring it back — otherwise the host would be stuck
          with no way to re-enable it on a phone. */}
      {available
        ? entries.length > 0 && (
            <button
              type="button"
              className="board__log-pill"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open the action log"
            >
              Log
            </button>
          )
        : canToggle && (
            <button type="button" className="board__log-pill" onClick={onToggle}>
              Show log
            </button>
          )}

      <Modal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        labelledBy="log-drawer-title"
        variant="modal__panel--drawer"
      >
        {body("log-drawer-title")}
      </Modal>
    </>
  );
}

/** A face-down opponent — name, tokens, fanned backs. Never a score. */
function Opponent({
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

/** Centered game wordmark so it's always clear which game this is. */
function BoardWordmark() {
  return (
    <div className="board__wordmark" aria-label="31 · National Parks Edition">
      <span className="board__wordmark-31">31</span>
      <span className="board__wordmark-sub">National Parks Edition</span>
    </div>
  );
}

/** Top-left park identity badge (reads the active theme). */
function BoardBadge() {
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
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
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
    <button className="board__tool" type="button" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

/** Top-right HUD: deal/round counter + tool buttons. `trailing` is the board-
 * specific final button (new-game for solo, leave for online). */
function BoardToolbar({
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

/**
 * The board's top bar as one in-flow row, shared by both boards. Composing the
 * park badge, game wordmark, and toolbar into a single flex row (rather than
 * three independently-positioned islands) is what keeps them from overlapping on
 * narrow screens — the row reserves its own height and lays the three groups out
 * left / center / right. The background stays transparent and each group keeps
 * its own translucent chip so the park scene still shows through. On small
 * screens the wordmark and the deal/round meta drop away (see GameBoard.css),
 * leaving just the badge and the tool buttons.
 */
export function BoardHeader({
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
    <header className="board__header">
      <BoardBadge />
      <BoardWordmark />
      <BoardToolbar
        dealNum={dealNum}
        roundNo={roundNo}
        aliveCount={aliveCount}
        onSwitchPark={onSwitchPark}
        onHelp={onHelp}
        trailing={trailing}
      />
    </header>
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
            {deckCount > 0 ? <CardBack size="md" /> : <span className="piles__empty">Empty</span>}
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
            {topDiscard && <span className="piles__label piles__label--under">Discard</span>}
          </button>
        </div>
        {status}
      </div>
    </div>
  );
}

/** The local player's head: avatar, name + turn label, and tokens. */
export function PlayerHead({ player, turnText }: { player: GamePlayer; turnText: string }) {
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
function HandFan({
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
              opacity: interactive && selected !== null && selected !== i ? 0.62 : 1,
              transition: "transform 0.14s ease, opacity 0.14s ease",
            }}
          />
        );
      })}
    </div>
  );
}

/** "Best suit {score}" readout under the hand. */
function HandHud({ score }: { score: number }) {
  return (
    <div className="board__hud">
      <span className="board__best">
        Best suit <strong>{formatScore(score)}</strong>
      </span>
    </div>
  );
}

/** Draw/Take/Knock buttons, or the single Discard button while discarding. */
function ActionBar({
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
          <button className="btn btn--draw" type="button" onClick={onDrawDeck} disabled={!canDraw}>
            Draw <span className="btn__mini">from</span> Deck
          </button>
          <button
            className="btn btn--draw"
            type="button"
            onClick={onTakeDiscard}
            disabled={!canDraw || !hasDiscard}
          >
            Take Discard
          </button>
          <button className="btn btn--knock" type="button" onClick={onKnock} disabled={!canKnock}>
            Knock
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The local player's turn control as one unit — head, fanned hand, best-suit HUD,
 * and the action buttons — shared by both boards. The boards differ only in how
 * state and callbacks are sourced (solo reducer vs. server snapshots) and pass
 * those in; `discardSelected` is derived from `selected`. Each board keeps its
 * own mode-specific wrapper (solo's AI-thinking / "Waiting…", online's
 * spectating branch) around this shared core.
 */
export function TurnControl({
  player,
  turnText,
  discarding,
  counting,
  selected,
  handScore,
  canDraw,
  hasDiscard,
  canKnock,
  onSelect,
  onDrawDeck,
  onTakeDiscard,
  onKnock,
  onConfirmDiscard,
}: {
  player: GamePlayer;
  turnText: string;
  discarding: boolean;
  counting: Suit | null;
  selected: number | null;
  handScore: number;
  canDraw: boolean;
  hasDiscard: boolean;
  canKnock: boolean;
  onSelect: (i: number) => void;
  onDrawDeck: () => void;
  onTakeDiscard: () => void;
  onKnock: () => void;
  onConfirmDiscard: () => void;
}) {
  return (
    <>
      <PlayerHead player={player} turnText={turnText} />
      <HandFan
        hand={player.hand}
        interactive={discarding}
        counting={counting}
        selected={selected}
        onSelect={onSelect}
      />
      <HandHud score={handScore} />
      <ActionBar
        discarding={discarding}
        canDraw={canDraw}
        hasDiscard={hasDiscard}
        canKnock={canKnock}
        discardSelected={selected !== null}
        onDrawDeck={onDrawDeck}
        onTakeDiscard={onTakeDiscard}
        onKnock={onKnock}
        onConfirmDiscard={onConfirmDiscard}
      />
    </>
  );
}

/**
 * The row of face-down opponents, shared by both boards. `activeSeat` (online)
 * highlights the seat whose turn it is; solo omits it (its current player is
 * shown in the TurnControl instead, so no opponent is ever "active").
 */
export function OpponentRow({
  opponents,
  knocker,
  activeSeat,
}: {
  opponents: { p: GamePlayer; i: number }[];
  knocker: number | null;
  activeSeat?: number | null;
}) {
  return (
    <div className="board__opponents">
      {opponents.map(({ p, i }) => (
        <Opponent key={p.id} player={p} isKnocker={knocker === i} isCurrent={activeSeat === i} />
      ))}
    </div>
  );
}
