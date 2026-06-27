# Park artwork — drop images here

This folder holds the raster (painted) artwork for each park. Vite discovers
files here at build time. The app prefers these images and **automatically
falls back to the built-in vector scenes** when a file is absent — so nothing
breaks while art is in progress, and there are no 404s.

> After adding or renaming a file, **restart the dev server** (or rebuild) so
> Vite's glob picks it up.

## Files the app looks for

Name files `<park-id>-scene.<ext>` and `<park-id>-back.<ext>`:

| File | Used for | Recommended size | Orientation |
|------|----------|------------------|-------------|
| `glacier-scene.jpg` | Glacier table background | 1600 × 1000 px | landscape (16:10) |
| `glacier-back.jpg` | Glacier card back artwork | 600 × 840 px | portrait (5:7) |
| `yellowstone-scene.jpg` | Yellowstone table background | 1600 × 1000 px | landscape (16:10) |
| `yellowstone-back.jpg` | Yellowstone card back artwork | 600 × 840 px | portrait (5:7) |

Notes:
- **Format:** `.jpg`, `.jpeg`, `.png`, or `.webp` all work — the `<ext>` is
  matched automatically; no code change needed.
- **Card backs:** generate the artwork only — the app draws the gold frame, the
  park name, and the "31" on top. Leave margins and **don't bake text into the
  card-back image.**
- **Backgrounds:** the table darkens the edges with a vignette and overlays the
  UI, so keep the focal subject roughly centered and the top corners
  uncluttered (the park badge sits top-left, round info top-right).
- Optimize before committing — aim for < 400 KB per background (JPG ~80% or
  WebP).

## Generation prompt (reuse for every park)

Paste into your image generator, swapping the **bracketed** line. Tuned to the
WPA National Parks poster look of the mockups.

> Vintage 1930s WPA national park travel poster illustration, screen-print
> style, flat layered color with subtle grain, limited earthy palette, bold
> geometric composition, dramatic depth with atmospheric haze between mountain
> ranges, soft graded sky, no text, no lettering, no border.
> **[PARK LINE]**
> Painterly but poster-like, cinematic, premium, high detail.

**Park lines:**
- **Glacier:** *Sharp snow-capped alpine peaks above a deep teal glacial lake,
  dark pine forest, a mountain goat on a rocky bluff, cool blue-green palette
  with warm gold accents, clear daylight.*
- **Yellowstone:** *A tall erupting geyser of white steam beside a Grand
  Prismatic thermal pool with concentric teal-green-orange rings, rolling ochre
  hills, lodgepole pines, a bison on a rise, golden-hour amber sky.*

For a **card back**, append:
`Tall vertical composition, simpler and more iconic, centered subject, generous margins.`

## Adding a brand-new park

1. Drop `mypark-scene.jpg` (+ optional `mypark-back.jpg`) here.
2. Add a theme entry in `src/themes.ts` with
   `sceneImage: parkSceneImage("mypark")`, `backImage: parkBackImage("mypark")`,
   a palette, tagline, avatars, and victory line.
3. Restart the dev server. It appears in the Park Picker automatically.
