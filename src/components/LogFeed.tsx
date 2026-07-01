/**
 * Public action feed — the table talk everyone can see: who drew from the deck
 * (card hidden), who took which card off the discard, what was discarded, and
 * who knocked. Used as a live feed on the board and as a catch-up on the
 * pass-the-device cover screen.
 */
import type { CardModel, Suit } from "../types";
import type { LogEntry } from "../game/engine";
import "./LogFeed.css";

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
const RED: Suit[] = ["hearts", "diamonds"];

function CardChip({ card }: { card: CardModel }) {
  return (
    <span className={`logfeed__card${RED.includes(card.suit) ? " logfeed__card--red" : ""}`}>
      {card.rank}
      {SUIT_SYMBOL[card.suit]}
    </span>
  );
}

function Line({ entry }: { entry: LogEntry }) {
  return (
    <li className="logfeed__line">
      <span className="logfeed__actor">{entry.actor}</span>{" "}
      {entry.kind === "deck" && <span>drew from the deck</span>}
      {entry.kind === "takeDiscard" && entry.card && (
        <span>
          took <CardChip card={entry.card} /> from the discard
        </span>
      )}
      {entry.kind === "discard" && entry.card && (
        <span>
          discarded <CardChip card={entry.card} />
        </span>
      )}
      {entry.kind === "knock" && <span className="logfeed__knock">knocked!</span>}
    </li>
  );
}

export default function LogFeed({
  entries,
  limit,
  className,
  emptyText,
  newestFirst = false,
}: {
  entries: LogEntry[];
  limit?: number;
  className?: string;
  emptyText?: string;
  /** Show the most recent move first (for the live feed); the end-of-deal
   * recap leaves this off to read chronologically. */
  newestFirst?: boolean;
}) {
  const recent = limit ? entries.slice(-limit) : entries;
  const items = newestFirst ? [...recent].reverse() : recent;
  return (
    <ul className={`logfeed ${className ?? ""}`}>
      {items.length === 0 && emptyText && <li className="logfeed__empty">{emptyText}</li>}
      {items.map((e) => (
        <Line key={e.id} entry={e} />
      ))}
    </ul>
  );
}
