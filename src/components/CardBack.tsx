/**
 * Themed card back. When a raster `backImage` is supplied it renders edge-to-
 * edge with no overlay — the artwork is expected to already include its own
 * framing and "31" lettering. The SVG `Emblem` fallback keeps a thin gold
 * frame (but no text) so it still reads as a card back.
 */
import { useState, type CSSProperties } from "react";
import type { ParkTheme } from "../types";
import { useTheme } from "./ParkThemeProvider";
import "./CardBack.css";

export interface CardBackProps {
  /** Defaults to the active theme; pass to show a specific park (e.g. promo). */
  theme?: ParkTheme;
  size?: "sm" | "md" | "lg";
  fanStyle?: CSSProperties;
  className?: string;
}

export default function CardBack({
  theme,
  size = "md",
  fanStyle,
  className,
}: CardBackProps) {
  const active = useTheme().theme;
  const t = theme ?? active;
  const Emblem = t.Emblem;
  const [imgFailed, setImgFailed] = useState(false);
  const useImg = t.backImage && !imgFailed;

  return (
    <div
      className={["cardback", `cardback--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      style={fanStyle}
    >
      {useImg ? (
        <img
          className="cardback__art"
          src={t.backImage}
          alt=""
          aria-hidden="true"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <>
          <Emblem className="cardback__art" />
          <div className="cardback__frame" />
        </>
      )}
    </div>
  );
}
