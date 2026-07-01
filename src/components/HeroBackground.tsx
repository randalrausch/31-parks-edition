/**
 * Full-viewport cinematic hero for the home screen.
 *
 * • Renders the active park's scene image edge-to-edge (SVG scene as fallback).
 * • Crossfades the whole world when the park changes (keeps the previous layer
 *   and fades the new one in over it).
 * • Sharp center, softly blurred + darkened edges (vignette) so the menu reads.
 * • Subtle ambient motion — drifting fog, floating dust, moving light rays, an
 *   occasional eagle, plus a per-park accent (light rays / steam / waving grass).
 *   Everything is tiny and slow; all of it stops under prefers-reduced-motion.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import type { ParkTheme } from "../types";
import { THEMES_BY_ID } from "../themes";
import "./HeroBackground.css";

const DUST = [
  { left: "12%", top: "30%", delay: "0s", dur: "13s" },
  { left: "28%", top: "62%", delay: "3s", dur: "16s" },
  { left: "47%", top: "22%", delay: "6s", dur: "12s" },
  { left: "63%", top: "54%", delay: "2s", dur: "15s" },
  { left: "78%", top: "34%", delay: "8s", dur: "14s" },
  { left: "88%", top: "66%", delay: "5s", dur: "17s" },
];

function HeroLayer({
  theme,
  className,
}: {
  theme: ParkTheme;
  className: string;
}) {
  const Scene = theme.Scene;
  return theme.sceneImage ? (
    <img
      className={className}
      src={theme.sceneImage}
      alt=""
      aria-hidden="true"
    />
  ) : Scene ? (
    <div className={className}>
      {/* Scene may be code-split (React.lazy) — cover the rare fallback load. */}
      <Suspense fallback={null}>
        <Scene className="hero__svg" />
      </Suspense>
    </div>
  ) : null;
}

export default function HeroBackground({ themeId }: { themeId: string }) {
  const [cur, setCur] = useState(themeId);
  const [prev, setPrev] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (themeId === cur) return;
    setPrev(cur);
    setCur(themeId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPrev(null), 900);
    return () => clearTimeout(timer.current);
  }, [themeId, cur]);

  const curTheme = THEMES_BY_ID[cur];
  const prevTheme = prev ? THEMES_BY_ID[prev] : null;

  return (
    <div className={`hero hero--${cur}`} aria-hidden="true">
      {/* crossfade stack */}
      {prevTheme && (
        <HeroLayer theme={prevTheme} className="hero__img hero__img--prev" />
      )}
      <HeroLayer theme={curTheme} className="hero__img hero__img--cur" />

      {/* blurred, masked edge copy of the current scene */}
      {curTheme.sceneImage && (
        <img
          className="hero__edge"
          src={curTheme.sceneImage}
          alt=""
          aria-hidden="true"
        />
      )}

      {/* ambient motion */}
      <div className="hero__rays" />
      <div className="hero__fog" />
      <div className="hero__accent" />
      <div className="hero__dust">
        {DUST.map((d, i) => (
          <span
            key={i}
            className="hero__mote"
            style={{
              left: d.left,
              top: d.top,
              animationDelay: d.delay,
              animationDuration: d.dur,
            }}
          />
        ))}
      </div>
      <svg className="hero__eagle" viewBox="0 0 64 24" aria-hidden="true">
        <path
          d="M2 14 Q 14 4 24 13 Q 30 17 32 12 Q 34 17 40 13 Q 50 4 62 14 Q 50 11 40 16 Q 34 19 32 15 Q 30 19 24 16 Q 14 11 2 14 Z"
          fill="rgba(20,16,10,0.55)"
        />
      </svg>

      {/* vignette + dark edges */}
      <div className="hero__vignette" />
    </div>
  );
}
