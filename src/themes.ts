/**
 * Theme registry — one entry per national park.
 *
 * Adding a new park is a single registry entry: give it a palette, a tagline,
 * a background (a raster `sceneImage` and/or a vector `Scene`), an `Emblem`
 * (card-back / picker thumbnail), a set of avatars, and victory copy. It then
 * appears automatically in the in-game Park Picker. A park is selectable when
 * its `status` is "available" and a non-selectable preview when "coming-soon" —
 * availability is driven by `status`, not by which background kind it ships.
 *
 * Glacier, Yellowstone, and Theodore Roosevelt are fully implemented and
 * available (Glacier and Yellowstone use vector `Scene`s, Theodore Roosevelt a
 * raster `sceneImage`). Yosemite, Zion, Grand Canyon, and Acadia are
 * coming-soon placeholders that demonstrate the extension path.
 */
import { lazy } from "react";
import type { ParkTheme } from "./types";
// The full-bleed vector scenes are large and only render as a FALLBACK when a
// park's raster `sceneImage` is absent or fails to load (see ParkScene /
// HeroBackground). Code-split them so the initial bundle doesn't carry every
// park's vector art up front; the consumers render them inside <Suspense>.
const GlacierScene = lazy(() => import("./art/GlacierScene"));
const YellowstoneScene = lazy(() => import("./art/YellowstoneScene"));
import { GlacierEmblem, YellowstoneEmblem, makePosterEmblem } from "./art/Emblems";
import {
  MountainAvatar,
  GoatAvatar,
  BisonAvatar,
  RangerAvatar,
  GeyserAvatar,
  MooseAvatar,
} from "./art/Avatars";

import { parkSceneImage, parkBackImage } from "./parkArt";

export const glacierTheme: ParkTheme = {
  id: "glacier",
  displayName: "Glacier",
  designation: "National Park",
  tagline: "Rugged peaks. Glacial lakes. Wild beauty.",
  status: "available",
  palette: {
    base: "#0b211c",
    surface: "#13322b",
    primary: "#1f5145",
    secondary: "#2f7e8c",
    soft: "#8fa395",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#2f6b6b",
  },
  sceneImage: parkSceneImage("glacier"),
  backImage: parkBackImage("glacier"),
  Scene: GlacierScene,
  Emblem: GlacierEmblem,
  avatars: [
    { key: "ranger", Art: RangerAvatar },
    { key: "goat", Art: GoatAvatar },
    { key: "mountain", Art: MountainAvatar },
    { key: "moose", Art: MooseAvatar },
  ],
  victoryMessage: "Glacier is calling and you answered.",
};

export const yellowstoneTheme: ParkTheme = {
  id: "yellowstone",
  displayName: "Yellowstone",
  designation: "National Park",
  tagline: "Geysers. Wildlife. Timeless wonder.",
  status: "available",
  palette: {
    base: "#1a1207",
    surface: "#2a1c0e",
    primary: "#2f3a1e",
    secondary: "#b5651d",
    soft: "#d9b87a",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#2f5a3a",
  },
  sceneImage: parkSceneImage("yellowstone"),
  backImage: parkBackImage("yellowstone"),
  Scene: YellowstoneScene,
  Emblem: YellowstoneEmblem,
  avatars: [
    { key: "bison", Art: BisonAvatar },
    { key: "geyser", Art: GeyserAvatar },
    { key: "ranger", Art: RangerAvatar },
    { key: "mountain", Art: MountainAvatar },
  ],
  victoryMessage: "The wild never felt so good.",
};

export const theodoreRooseveltTheme: ParkTheme = {
  id: "theodoreroosevelt",
  displayName: "Theodore Roosevelt",
  designation: "National Park",
  tagline: "Badlands, bison, and the strenuous life.",
  status: "available",
  palette: {
    base: "#241410",
    surface: "#36231a",
    primary: "#7c4a2a",
    secondary: "#b5732f",
    soft: "#c9a36a",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#5a6b3a",
  },
  sceneImage: parkSceneImage("theodoreroosevelt"),
  backImage: parkBackImage("theodoreroosevelt"),
  // No bespoke SVG scene — relies on the raster image (falls back to nothing
  // only if the image is somehow missing, which it isn't).
  Emblem: makePosterEmblem({
    id: "tr",
    skyTop: "#9db4c2",
    skyBottom: "#e6d2a8",
    land: "#241410",
    peak: "#8a4a28",
  }),
  avatars: [
    { key: "bison", Art: BisonAvatar },
    { key: "mountain", Art: MountainAvatar },
    { key: "ranger", Art: RangerAvatar },
  ],
  victoryMessage: "The credit belongs to the one in the arena.",
};

/* ── Coming-soon placeholders — demonstrate the one-entry extension path ── */

const yosemiteTheme: ParkTheme = {
  id: "yosemite",
  displayName: "Yosemite",
  designation: "National Park",
  tagline: "Granite giants and high sierra light.",
  status: "coming-soon",
  palette: {
    base: "#15211a",
    surface: "#223026",
    primary: "#3f6135",
    secondary: "#7d8a5a",
    soft: "#b6b487",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#3f6135",
  },
  Emblem: makePosterEmblem({
    id: "yos",
    skyTop: "#9fb8c4",
    skyBottom: "#e3e3cf",
    land: "#1d2a1f",
    peak: "#5f7a66",
  }),
  avatars: [{ key: "mountain", Art: MountainAvatar }],
  victoryMessage: "The range of light is yours.",
};

const zionTheme: ParkTheme = {
  id: "zion",
  displayName: "Zion",
  designation: "National Park",
  tagline: "Red canyon walls and emerald pools.",
  status: "coming-soon",
  palette: {
    base: "#2a1410",
    surface: "#3a1d14",
    primary: "#7c3a1e",
    secondary: "#c96a2c",
    soft: "#d8a86b",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#5a7a3a",
  },
  Emblem: makePosterEmblem({
    id: "zion",
    skyTop: "#c79a6a",
    skyBottom: "#efd9b0",
    land: "#2a1410",
    peak: "#9b4a23",
  }),
  avatars: [{ key: "mountain", Art: MountainAvatar }],
  victoryMessage: "The canyon remembers your name.",
};

const grandCanyonTheme: ParkTheme = {
  id: "grand-canyon",
  displayName: "Grand Canyon",
  designation: "National Park",
  tagline: "A mile down through deep time.",
  status: "coming-soon",
  palette: {
    base: "#28140c",
    surface: "#3a1e12",
    primary: "#8b3a1c",
    secondary: "#c4652a",
    soft: "#d8a86b",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#3f6135",
  },
  Emblem: makePosterEmblem({
    id: "gc",
    skyTop: "#c88a52",
    skyBottom: "#f0d9aa",
    land: "#28140c",
    peak: "#a14a22",
  }),
  avatars: [{ key: "mountain", Art: MountainAvatar }],
  victoryMessage: "You stood on the rim of forever.",
};

const acadiaTheme: ParkTheme = {
  id: "acadia",
  displayName: "Acadia",
  designation: "National Park",
  tagline: "Where the mountains meet the sea.",
  status: "coming-soon",
  palette: {
    base: "#0e1c24",
    surface: "#162a33",
    primary: "#1f4d55",
    secondary: "#3a7d86",
    soft: "#8fb0b3",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#2f6b6b",
  },
  Emblem: makePosterEmblem({
    id: "aca",
    skyTop: "#b9c9d2",
    skyBottom: "#e9ddc4",
    land: "#0e1c24",
    peak: "#3a6168",
  }),
  avatars: [{ key: "mountain", Art: MountainAvatar }],
  victoryMessage: "First light in the nation reached you.",
};

/** The registry, in display order. Add new parks here. */
export const PARK_THEMES: ParkTheme[] = [
  glacierTheme,
  yellowstoneTheme,
  theodoreRooseveltTheme,
  yosemiteTheme,
  zionTheme,
  grandCanyonTheme,
  acadiaTheme,
];

export const THEMES_BY_ID: Record<string, ParkTheme> = Object.fromEntries(
  PARK_THEMES.map((t) => [t.id, t]),
);

export const PLAYABLE_THEMES = PARK_THEMES.filter((t) => t.status === "available");

export const DEFAULT_THEME_ID = glacierTheme.id;
