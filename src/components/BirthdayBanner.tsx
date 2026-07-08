/**
 * A once-a-year easter egg for the board (see src/game/birthday.ts). Renders
 * nothing on any other day. Non-blocking — confetti and a dismissible card,
 * no focus trap, doesn't interrupt play.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { BIRTHDAY, isBirthdayToday } from "../game/birthday";
import "./BirthdayBanner.css";

const CONFETTI_COLORS = [
  "var(--gold)",
  "var(--gold-bright)",
  "var(--ember)",
  "var(--ember-bright)",
  "var(--cream)",
];
const CONFETTI_COUNT = 36;

export default function BirthdayBanner() {
  const [dismissed, setDismissed] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 2.5}s`,
        duration: `${3.2 + Math.random() * 2.2}s`,
        drift: `${(Math.random() - 0.5) * 120}px`,
        rotate: `${Math.random() * 360}deg`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [],
  );

  if (dismissed || !isBirthdayToday()) return null;

  return (
    <div className="birthday" role="status">
      <div className="birthday__confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="birthday__piece"
            style={
              {
                left: p.left,
                animationDelay: p.delay,
                animationDuration: p.duration,
                "--drift": p.drift,
                "--rotate": p.rotate,
                background: p.color,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="birthday__card">
        <button
          className="birthday__close"
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss birthday greeting"
        >
          ✕
        </button>
        <span className="birthday__eyebrow">Happy Birthday</span>
        <h2 className="birthday__title">{BIRTHDAY.name}!</h2>
        <p className="birthday__msg">Hope it's a great one this year.</p>
      </div>
    </div>
  );
}
