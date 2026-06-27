# Adding a National Park theme

Themes are the heart of this project, and **new parks are very welcome** — it's
the best way to contribute. A theme is mostly **art + a palette + one registry
entry**, and the in‑game Park Picker discovers it automatically.

There are two paths:

- **Easy path (recommended):** drop in two images and add one theme entry. No
  SVG drawing required. ~20 minutes.
- **Advanced path:** hand‑draw a vector scene for crisp, infinitely scalable art
  (how Glacier and Yellowstone are built).

Either way you'll end up adding one object to `src/themes.ts`.

---

## What a theme is

Each park is a `ParkTheme` (see `src/types.ts`):

```ts
interface ParkTheme {
  id: string;              // kebab-case, unique, matches asset filenames
  displayName: string;     // "Yosemite"
  designation: string;     // usually "National Park"
  tagline: string;         // one-line poster tagline
  status: "available" | "coming-soon";
  palette: ThemePalette;   // 9 colors (see below)
  sceneImage?: string;     // raster table background (easy path)
  backImage?: string;      // raster card-back art (optional)
  Scene?: ComponentType;   // vector table background (advanced path)
  Emblem: ComponentType;   // small art for card backs + picker thumbnail
  avatars: AvatarArt[];    // seat avatars (reuse existing or add new)
  victoryMessage: string;  // shown to the winner
}
```

The palette drives the whole UI via CSS variables, so a good palette alone makes
the app feel like a different park:

```ts
palette: {
  base:      "#0b211c", // darkest — deep shadow / chrome background
  surface:   "#13322b", // panels and plaques
  primary:   "#1f5145", // main nature accent (forest/olive)
  secondary: "#2f7e8c", // cool or warm mid tone (lake/ochre)
  soft:      "#8fa395", // light tone (sage/tan)
  cream:     "#f4e3b2", // paper cream — keep consistent across parks
  gold:      "#d6a84f", // gold linework — keep consistent
  ember:     "#c9571c", // the KNOCK button (burnt orange)
  draw:      "#2f6b6b", // the DRAW button (themed)
}
```

> Tip: keep `cream` and `gold` close to the existing values so the typography
> and frames stay consistent across parks; spend your creativity on
> `primary` / `secondary` / `soft` / `draw`.

---

## Easy path — images + one entry

### 1. Scaffold (optional helper)

```bash
node scripts/new-theme.mjs yosemite "Yosemite"
```

This prints a ready‑to‑paste theme entry and reminds you where the art goes. You
can also do everything by hand below.

### 2. Add the art

Drop two images into `src/assets/parks/` named by your theme `id`:

| File | Used for | Recommended | Notes |
|------|----------|-------------|-------|
| `<id>-scene.jpg` | Table background | 1600×1000 landscape | keep the top corners calm (the badge/round info sit there); the board adds a vignette |
| `<id>-back.jpg`  | Card‑back artwork | 600×840 portrait | optional; if omitted, the SVG `Emblem` is used. **Bake any "31"/title text into the image yourself** — the app does not overlay text on raster card backs |

`.jpg`, `.png`, and `.webp` all work; the extension is matched automatically.
Optimize before committing (aim < 400 KB per image; `cwebp -q 82` is great). See
`src/assets/parks/README.md` for a ready‑made WPA art‑generation prompt.

Vite discovers these at build time via `src/parkArt.ts` — **restart the dev
server** after adding files.

### 3. Register the theme

Add an entry to `src/themes.ts` and include it in the `PARK_THEMES` array. For
the easy path, use the generic `makePosterEmblem` for the card‑back/thumbnail
(no SVG needed):

```ts
// at the top of src/themes.ts (these imports already exist there):
import type { ParkTheme } from "./types";
import { parkSceneImage, parkBackImage } from "./parkArt";
import { makePosterEmblem } from "./art/Emblems";
import { MountainAvatar, RangerAvatar, BisonAvatar } from "./art/Avatars";

export const yosemiteTheme: ParkTheme = {
  id: "yosemite",
  displayName: "Yosemite",
  designation: "National Park",
  tagline: "Granite giants and high sierra light.",
  status: "available",
  palette: {
    base: "#15211a", surface: "#223026", primary: "#3f6135",
    secondary: "#7d8a5a", soft: "#b6b487", cream: "#f4e3b2",
    gold: "#d6a84f", ember: "#c9571c", draw: "#3f6135",
  },
  sceneImage: parkSceneImage("yosemite"),
  backImage: parkBackImage("yosemite"),
  Emblem: makePosterEmblem({
    id: "yos", skyTop: "#9fb8c4", skyBottom: "#e3e3cf",
    land: "#1d2a1f", peak: "#5f7a66",
  }),
  avatars: [
    { key: "mountain", Art: MountainAvatar },
    { key: "ranger", Art: RangerAvatar },
    { key: "bison", Art: BisonAvatar },
  ],
  victoryMessage: "The range of light is yours.",
};
```

Then add it to the registry list:

```ts
export const PARK_THEMES: ParkTheme[] = [
  glacierTheme,
  yellowstoneTheme,
  theodoreRooseveltTheme,
  yosemiteTheme,   // ← your park
  // …
];
```

Set `status: "available"` once it has a scene image; use `"coming-soon"` to list
it in the picker as a non‑selectable preview while you finish the art.

That's it — run `npm run dev`, open **Settings → Theme** (or the in‑game park
switcher), and your park is playable.

---

## Advanced path — a vector scene

For crisp, resolution‑independent art, draw an SVG scene component like
`src/art/GlacierScene.tsx`. It's a React component taking `{ className }` and
returning an `<svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">`
with flat WPA‑style layers (graded sky, two‑tone peaks, water, framing pines, a
focal animal). Then set `Scene: YourScene` in the theme (instead of, or in
addition to, `sceneImage` — the raster image wins when present).

Likewise you can draw a bespoke `Emblem` (a small 120×168 card‑aspect SVG, see
`src/art/Emblems.tsx`) instead of `makePosterEmblem`.

**Avatars** live in `src/art/Avatars.tsx` as 64×64 medallions. Reuse existing
ones (`mountain`, `ranger`, `bison`, `goat`, `geyser`, `moose`) or add your own
and register them in `AVATAR_ART`.

---

## Checklist

- [ ] Unique kebab‑case `id`, matching the asset filenames
- [ ] 9‑color palette set
- [ ] `sceneImage` (or an SVG `Scene`)
- [ ] `Emblem` (`makePosterEmblem` or a custom SVG)
- [ ] At least one avatar
- [ ] `tagline` + `victoryMessage`
- [ ] Added to `PARK_THEMES`
- [ ] `status: "available"`
- [ ] Images optimized (< ~400 KB each)
- [ ] `npm run typecheck && npm run build` pass
- [ ] Original art only — inspired by public‑domain WPA poster style, not copies

## Multiplayer note

Themes are purely cosmetic and **client‑side** — each player can pick their own
park view in an online game; it doesn't affect shared game state. So adding a
theme never touches the backend.

Open a PR with a screenshot of your park's board.
