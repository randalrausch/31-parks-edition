/**
 * Small reusable vector glyphs: playing-card suits, an NPS-style arrowhead,
 * pine trees, a star divider, and a compass rose. All inherit `currentColor`
 * unless a fill is passed, so they recolor per theme.
 */
import type { Suit } from "../types";

/** Suit outlines in a 0–100 viewBox. Exported so cards can reuse the exact
 * shapes (e.g. the suit mark on a court card) instead of re-drawing them. */
export const SUIT_PATHS: Record<Suit, string> = {
  spades:
    "M50 6 C 38 30 8 40 8 62 C 8 78 26 84 40 74 C 36 84 32 90 24 94 L 76 94 C 68 90 64 84 60 74 C 74 84 92 78 92 62 C 92 40 62 30 50 6 Z",
  hearts:
    "M50 92 C 16 64 8 46 8 30 C 8 14 24 6 38 16 C 44 20 48 26 50 32 C 52 26 56 20 62 16 C 76 6 92 14 92 30 C 92 46 84 64 50 92 Z",
  diamonds: "M50 4 C 66 30 80 44 96 50 C 80 56 66 70 50 96 C 34 70 20 56 4 50 C 20 44 34 30 50 4 Z",
  clubs:
    "M50 6 C 36 6 26 22 33 36 C 22 28 6 34 6 50 C 6 64 22 70 34 60 C 30 74 26 84 18 94 L 82 94 C 74 84 70 74 66 60 C 78 70 94 64 94 50 C 94 34 78 28 67 36 C 74 22 64 6 50 6 Z",
};

export function SuitGlyph({
  suit,
  className,
  color,
}: {
  suit: Suit;
  className?: string;
  color?: string;
}) {
  const fill = color ?? "currentColor";
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={SUIT_PATHS[suit]} fill={fill} />
    </svg>
  );
}

/** Stylized National-Park-Service-style arrowhead emblem. */
export function NpsArrowhead({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 96"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 8 H72 V58 Q72 78 40 92 Q8 78 8 58 Z"
        fill="#5a3d1d"
        stroke="#d6a84f"
        strokeWidth="3"
      />
      {/* sequoia */}
      <polygon points="26,70 34,40 42,70" fill="#1f5145" />
      <polygon points="27,72 34,52 41,72" fill="#143329" />
      <rect x="32" y="68" width="4" height="12" fill="#2b1b10" />
      {/* mountains */}
      <polygon points="40,64 56,38 70,64" fill="#8fa395" />
      <polygon points="56,38 62,49 50,49" fill="#f4e3b2" />
      {/* water */}
      <rect x="14" y="74" width="52" height="6" fill="#3a6f7a" rx="2" />
    </svg>
  );
}

export function StarDivider({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 16"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <line x1="0" y1="8" x2="86" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="114" y1="8" x2="200" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <polygon
        points="100,1 102.5,6.5 108,7 103.5,10.5 105,16 100,12.7 95,16 96.5,10.5 92,7 97.5,6.5"
        fill="currentColor"
      />
    </svg>
  );
}
