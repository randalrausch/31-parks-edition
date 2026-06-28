/**
 * A single playing card. Aged-cream WPA front with classic ranks and suits;
 * court cards get a gold crown/figure treatment. Supports hover, selection,
 * and a "counting suit" highlight, plus a fan transform for hands.
 */
import type { CSSProperties } from "react";
import type { CardModel, Suit } from "../types";
import { SuitGlyph, SUIT_PATHS } from "../art/Glyphs";
import "./Card.css";

const RED: Suit[] = ["hearts", "diamonds"];

/** Crown / tiara / fleur treatment for the court cards, with a clear suit
 * medallion so the suit (which determines scoring) reads at a glance. */
function CourtFigure({
  rank,
  suit,
  color,
}: {
  rank: "J" | "Q" | "K";
  suit: Suit;
  color: string;
}) {
  return (
    <svg viewBox="0 0 100 120" className="card__court" aria-hidden="true">
      <rect
        x="10"
        y="8"
        width="80"
        height="104"
        rx="6"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.5"
        opacity="0.8"
      />
      {rank === "K" && (
        <g>
          <path
            d="M30 40 L30 26 L40 36 L50 22 L60 36 L70 26 L70 40 Z"
            fill="var(--gold)"
          />
          <rect x="30" y="40" width="40" height="6" fill="var(--gold)" />
          <circle cx="50" cy="20" r="3.5" fill="var(--gold)" />
        </g>
      )}
      {rank === "Q" && (
        <g>
          <path d="M32 40 Q50 18 68 40 Z" fill="var(--gold)" />
          <circle cx="32" cy="38" r="4" fill="var(--gold)" />
          <circle cx="50" cy="26" r="4.5" fill="var(--gold)" />
          <circle cx="68" cy="38" r="4" fill="var(--gold)" />
        </g>
      )}
      {rank === "J" && (
        <g>
          <path d="M34 38 Q50 26 66 38 L62 46 L38 46 Z" fill="var(--gold)" />
          <path d="M50 22 L54 34 L46 34 Z" fill="var(--gold)" />
        </g>
      )}
      {/* robed body suggestion */}
      <path
        d="M22 114 Q22 74 50 64 Q78 74 78 114 Z"
        fill={color}
        opacity="0.9"
      />
      <path
        d="M50 64 L50 114"
        stroke="var(--gold)"
        strokeWidth="1.5"
        opacity="0.7"
      />
      {/* Suit medallion — the at-a-glance suit indicator */}
      <circle
        cx="50"
        cy="74"
        r="20"
        fill="var(--card-cream)"
        stroke={color}
        strokeWidth="2.5"
      />
      <g transform="translate(31, 55) scale(0.38)">
        <path d={SUIT_PATHS[suit]} fill={color} />
      </g>
    </svg>
  );
}

export interface CardProps {
  card: CardModel;
  /** Gold ring — marks cards currently counting toward your suit score. */
  counting?: boolean;
  selected?: boolean;
  interactive?: boolean;
  onSelect?: (card: CardModel) => void;
  /** Fan transform applied to the card (rotation + lift) within a hand. */
  fanStyle?: CSSProperties;
  size?: "sm" | "md" | "lg";
}

export default function Card({
  card,
  counting = false,
  selected = false,
  interactive = false,
  onSelect,
  fanStyle,
  size = "md",
}: CardProps) {
  const isRed = RED.includes(card.suit);
  const color = isRed ? "var(--card-red)" : "var(--card-ink)";
  const isCourt = card.rank === "J" || card.rank === "Q" || card.rank === "K";

  const className = [
    "card",
    `card--${size}`,
    counting && "card--counting",
    selected && "card--selected",
    interactive && "card--interactive",
  ]
    .filter(Boolean)
    .join(" ");

  const Tag = interactive ? "button" : "div";

  return (
    <Tag
      className={className}
      style={fanStyle}
      onClick={interactive ? () => onSelect?.(card) : undefined}
      aria-label={`${card.rank} of ${card.suit}`}
      {...(interactive ? { type: "button" as const } : {})}
    >
      <span className="card__corner card__corner--tl" style={{ color }}>
        <span className="card__rank">{card.rank}</span>
        <SuitGlyph
          suit={card.suit}
          className="card__corner-suit"
          color={color}
        />
      </span>

      <span className="card__center">
        {isCourt ? (
          <CourtFigure
            rank={card.rank as "J" | "Q" | "K"}
            suit={card.suit}
            color={color}
          />
        ) : (
          <SuitGlyph
            suit={card.suit}
            className="card__center-suit"
            color={color}
          />
        )}
      </span>

      <span className="card__corner card__corner--br" style={{ color }}>
        <span className="card__rank">{card.rank}</span>
        <SuitGlyph
          suit={card.suit}
          className="card__corner-suit"
          color={color}
        />
      </span>
    </Tag>
  );
}
