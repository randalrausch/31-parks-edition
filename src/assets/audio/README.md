# Ambient audio — drop loops here

Per-park ambient sound for the home screen. Name each file by the park id:

| File | Suggested sound |
|------|-----------------|
| `glacier.mp3` | Alpine wind + distant waterfall |
| `yellowstone.mp3` | Low geyser rumble + bubbling springs |
| `theodoreroosevelt.mp3` | Prairie breeze + grass + far birdsong |

- Use a **seamless loop**, 20–60 s, **mono or light stereo**, exported small
  (MP3 ~96 kbps is plenty; aim < 1 MB each).
- `.mp3`, `.ogg`, or `.m4a` all work; the extension is matched automatically.
- Discovered at build time — **restart the dev server** after adding files.
- Browsers block autoplay, so sound starts only when the player taps the
  speaker toggle on the home screen. Changing parks crossfades the loop.
- Free sources: Freesound.org (CC0), Pixabay Audio, or your own field
  recordings. Make sure the license allows redistribution.
