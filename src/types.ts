import type { ComponentType, LazyExoticComponent } from "react";

/** A scene/art component that may be code-split (React.lazy) to keep it out of
 * the initial bundle — rendered inside a <Suspense> boundary by its consumer. */
type SceneComponent =
  | ComponentType<{ className?: string }>
  | LazyExoticComponent<ComponentType<{ className?: string }>>;

/* ──────────────────────────────────────────────────────────────────────────
   Card model
   ────────────────────────────────────────────────────────────────────────── */

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export type Rank =
  "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface CardModel {
  id: string;
  rank: Rank;
  suit: Suit;
}

/** Point value of a card in 31 — Ace 11, face cards 10, pips at face value. */
export function cardValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

/* ──────────────────────────────────────────────────────────────────────────
   Players
   ────────────────────────────────────────────────────────────────────────── */

/* The authoritative player shape lives in the game core as `GamePlayer`
   (src/game/engine.ts); the UI renders directly from that redacted state. */

/* ──────────────────────────────────────────────────────────────────────────
   Themes — each national park is one registry entry. See themes.ts.
   ────────────────────────────────────────────────────────────────────────── */

export interface ThemePalette {
  /** Darkest base — deep forest / canyon shadow. */
  base: string;
  /** Mid surface for plaques and panels. */
  surface: string;
  /** Primary nature accent (pine green / olive). */
  primary: string;
  /** Cool or warm mid tone (teal lake / ochre). */
  secondary: string;
  /** Soft light tone (sage / tan). */
  soft: string;
  /** Paper cream — card fronts and headings. */
  cream: string;
  /** Gold linework and frames. */
  gold: string;
  /** Burnt-orange call-to-action (the KNOCK button). */
  ember: string;
  /** The DRAW button fill — cool for Glacier, green for Yellowstone. */
  draw: string;
}

export interface AvatarArt {
  /** Stable key referenced by a player's `avatarKey`. */
  key: string;
  /** Small medallion illustration (drawn inside a circular clip). */
  Art: ComponentType;
}

export interface ParkTheme {
  id: string;
  /** "GLACIER", "YELLOWSTONE" — shown large in Bebas Neue. */
  displayName: string;
  /** Usually "NATIONAL PARK". */
  designation: string;
  /** One-line poster tagline. */
  tagline: string;
  /** Whether this park is playable yet or a "coming soon" slot in the picker. */
  status: "available" | "coming-soon";
  palette: ThemePalette;
  /**
   * Optional raster background (WPA-style painting). When present it renders as
   * the table background; if it fails to load (or is absent) the SVG `Scene`
   * is used instead. Path is resolved via `parkSceneImage()` (see parkArt.ts).
   */
  sceneImage?: string;
  /** Optional raster card-back artwork; falls back to the SVG `Emblem`. */
  backImage?: string;
  /** Optional full-bleed vector background; a park may instead ship a raster
   * `sceneImage`. ParkScene prefers `sceneImage` and falls back to this. May be
   * a lazily-loaded (code-split) component — render it inside <Suspense>. */
  Scene?: SceneComponent;
  /** Compact scene used on card backs and picker thumbnails. */
  Emblem: ComponentType<{ className?: string }>;
  /** Avatars available for this park's seats. */
  avatars: AvatarArt[];
  /** Headline on the victory panel, e.g. "THE WILD NEVER FELT SO GOOD." */
  victoryMessage: string;
}
