/**
 * A single playing card. Aged-cream WPA front with classic ranks and suits;
 * court cards get a gold crown/figure treatment. Supports hover, selection,
 * and a "counting suit" highlight, plus a fan transform for hands.
 */
import type { CSSProperties } from "react";
import type { CardModel, Suit } from "../types";
import { SuitGlyph } from "../art/Glyphs";
import "./Card.css";

const RED: Suit[] = ["hearts", "diamonds"];

/** Crown / tiara / fleur treatment for the court cards. */
function CourtFigure({
  rank,
  color,
}: {
  rank: "J" | "Q" | "K";
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
            d="M30 44 L30 30 L40 40 L50 26 L60 40 L70 30 L70 44 Z"
            fill="var(--gold)"
          />
          <rect x="30" y="44" width="40" height="6" fill="var(--gold)" />
          <circle cx="50" cy="24" r="3.5" fill="var(--gold)" />
        </g>
      )}
      {rank === "Q" && (
        <g>
          <path d="M32 44 Q50 22 68 44 Z" fill="var(--gold)" />
          <circle cx="32" cy="42" r="4" fill="var(--gold)" />
          <circle cx="50" cy="30" r="4.5" fill="var(--gold)" />
          <circle cx="68" cy="42" r="4" fill="var(--gold)" />
        </g>
      )}
      {rank === "J" && (
        <g>
          <path d="M34 42 Q50 30 66 42 L62 50 L38 50 Z" fill="var(--gold)" />
          <path d="M50 26 L54 38 L46 38 Z" fill="var(--gold)" />
        </g>
      )}
      {/* robed body suggestion */}
      <path
        d="M28 112 Q28 64 50 56 Q72 64 72 112 Z"
        fill={color}
        opacity="0.9"
      />
      <path
        d="M50 56 L50 112"
        stroke="var(--gold)"
        strokeWidth="1.5"
        opacity="0.7"
      />
      <circle
        cx="50"
        cy="60"
        r="9"
        fill="var(--card-cream)"
        stroke={color}
        strokeWidth="2"
      />
      <SuitGlyphInline x={50} y={60} color={color} />
    </svg>
  );
}

/** Small suit mark centered at (x,y) in the court figure's medallion. */
function SuitGlyphInline({
  x,
  y,
  color,
}: {
  x: number;
  y: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x - 6}, ${y - 6}) scale(0.12)`}>
      <path
        d="M50 6 C 38 30 8 40 8 62 C 8 78 26 84 40 74 C 36 84 32 90 24 94 L 76 94 C 68 90 64 84 60 74 C 74 84 92 78 92 62 C 92 40 62 30 50 6 Z"
        fill={color}
      />
    </g>
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
          <CourtFigure rank={card.rank as "J" | "Q" | "K"} color={color} />
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
