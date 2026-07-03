# Opponent portraits — drop images here

This folder holds the raster (painted) portraits for the ten AI opponents. Vite
discovers files here at build time. Each character in `src/game/aiCharacters.ts`
has an `image` key naming its file; the app **falls back to a built-in vector
avatar** when a file is absent, so nothing breaks while art is in progress.

> After adding or renaming a file, **restart the dev server** (or rebuild) so
> Vite's glob picks it up.

## Files the app looks for

Name files `<character-id>.webp` (the id is the character's key in
`aiCharacters.ts`). The extension is auto-matched, so `.jpg`, `.jpeg`, `.png`, or
`.webp` all work. Current portraits:

`backcountry-ben`, `badlands-becky`, `bison-bill`, `coyote-cody`,
`half-dome-hank`, `naturalist-nora`, `paula-pine`, `prairie-rose`, `ranger-rick`,
`summit-sam`.

- **Recommended size:** ~512 × 512 px, square. Rendered in a round frame, so keep
  the face centered with headroom.
- Optimize before committing — aim for < 120 KB (WebP ~80%).

## Generation prompt (reuse for every opponent)

Paste into your image generator, swapping the **bracketed** line. Tuned to match
the WPA-poster look of the park scenes.

> Vintage 1930s WPA national-park poster–style character portrait, screen-print
> look, flat layered color with subtle grain, limited earthy palette, bold
> geometric shapes, warm and friendly, head-and-shoulders, centered, no text, no
> border.
> **[CHARACTER LINE]**
> Painterly but poster-like, premium, high detail.

Example character line — **Ranger Rick:** *a cheerful national-park ranger in a
flat-brim hat and olive uniform, weathered friendly face, pine trees behind.*

## Licensing

All portraits here are created for this project and released under the repo's
[MIT License](../../../LICENSE). Any contributed replacement art must be
original (or public-domain / CC0) and is contributed under the same license.
