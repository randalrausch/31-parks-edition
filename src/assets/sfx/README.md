# Sound effects — optional public-domain overrides

The game ships with soft **synthesized** sound effects (tuned to be subtle for
dealing and a solid wooden "tock" for knocking). To use real recorded samples
instead, drop files here named by effect — they override the synth automatically
at build time:

| File | Effect | Notes |
|------|--------|-------|
| `deal.mp3` | Card dealt / drawn | Short, soft single-card flick (~0.1–0.3 s). |
| `knock.mp3` | Knock | A solid double knock on wood. |
| `coin.mp3` | Token lost | A coin clink / drop. |

`.mp3`, `.ogg`, or `.wav` all work; the extension is matched automatically.
Keep them short and small, and **restart the dev server** after adding files.

## Recommended public-domain / CC0 sources

Verify each clip's license on its page before downloading (filter for **CC0 /
Public Domain**, which needs no attribution):

**Wood knock**
- [Freesound — "wood door knock" by ripper351](https://freesound.org/people/ripper351/sounds/151088/)
- [Freesound — "Knock on Wood - Fast" by PsychoPancake](https://freesound.org/people/PsychoPancake/sounds/325229/)
- [OpenGameArt — 100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx)
- [Pixabay — door-knock sounds (no attribution)](https://pixabay.com/sound-effects/search/knocking-door/)
- [BigSoundBank — Door Knock](https://bigsoundbank.com/door-knock-s0095.html)

**Card deal / flick**
- [Pixabay — card sound effects (no attribution)](https://pixabay.com/sound-effects/search/card/)
- [Freesound — CC0 tag browse](https://freesound.org/browse/tags/cc0/)
- [OpenGameArt — CC0 sound effects](https://opengameart.org/content/cc0-sound-effects)
- [ZapSplat — CC0 1.0 Universal license library](https://www.zapsplat.com/license-type/cc0-1-0-universal/)

A good "card deal" is often labeled *card flick*, *card slide*, or *single card
deal* — pick the softest, driest one (avoid reverb/echo).
