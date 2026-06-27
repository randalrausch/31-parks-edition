# 31 · National Parks Edition

A vintage **WPA‑poster**‑styled implementation of the classic card game **31** —
play solo against characterful AI rangers, pass‑and‑play with friends on one
device, or online across devices. Built as a fast, self‑contained
**React + TypeScript + Vite** app with an *optional* **Supabase** backend for
real‑time, asynchronous online multiplayer.

> Build the highest hand you can in a single suit — as close to **31** as
> possible. Knock when you're confident; each deal the lowest hand loses a
> token. The last player holding a token wins.

### Three ways to play

| Mode | Players | Setup |
|------|---------|-------|
| **Solo vs AI** | You + AI rangers | ✅ none |
| **Pass‑and‑play** | 2–8 humans sharing one device (hidden‑hand "pass the device" screens) | ✅ none |
| **Online** | Friends on their own devices, real‑time or async | needs a free Supabase project |

**Two of the three modes — including local multiplayer — work with zero
configuration.** You only need Supabase if you want to play *online across
devices*.

- 🎴 **Complete game of 31** — draw/discard/knock, Grace, knock penalty, instant
  31, elimination, end‑of‑game score chart.
- 👥 **Pass‑and‑play** — 2–8 humans on one device, with pass‑the‑device cover
  screens so nobody sees another's hand. No internet, no accounts.
- 🤖 **10 AI characters** with distinct, trait‑driven personalities (bluff,
  memory, patience, aggression, risk).
- 🏔 **Themed national parks** (Glacier, Yellowstone, Theodore Roosevelt) with
  original WPA‑style art — and a **one‑file path to add your own** (see below).
- 🌐 **Online multiplayer** (optional) — server‑authoritative and **async**: take
  your turn whenever; the saved game waits for you.
- 📱 **Installable PWA** — add it to your phone's home screen; works offline for
  solo play.
- ✅ **Tested** — pure game logic covered by unit + fuzz tests; CI on every push.

---

## Quick start

Requires **Node 20+**.

```bash
git clone <your-fork-url> 31-parks-edition
cd 31-parks-edition
npm install
npm run dev          # http://localhost:5173
```

That's it — **solo play and local pass‑and‑play work with zero configuration.**
On the home screen choose how many humans and AI rangers to seat and hit *Start
Solo Adventure*; with two or more humans you'll pass the device between turns
with hidden‑hand cover screens. Online multiplayer is optional and needs a free
Supabase project; see [docs/SUPABASE.md](docs/SUPABASE.md).

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Type‑check + build a static bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit + fuzz test suite (Vitest) |
| `npm run test:watch` | Watch‑mode tests |
| `npm run typecheck` | Type‑check only |
| `npm run build:edge` | Re‑bundle the shared engine for the Supabase Edge Function |

## Deploy

`npm run build` emits a plain static site in `dist/` — host it **anywhere**
(Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3, …). See
[docs/DEPLOY.md](docs/DEPLOY.md) for per‑host instructions and the SPA redirect
rule.

## Project structure

```text
src/
  game/            Framework-free game core (engine, reducer, AI, transports)
    engine.ts        Rules: scoring, tokens/grace, AI trait→behaviour mappings
    actions.ts       Pure reducer: applyAction(state, action) — the authority
    authority.ts     Server brain: redactState / advanceAuthority / applyPlayerAction
    useGame.ts       Solo presentation layer over the reducer (animation, AI, sound)
    transport.ts     Transport interface + LocalTransport
    networkTransport.ts / useNetworkGame.ts   Online sync over Supabase
    *.test.ts        Unit + fuzz tests
  components/       React UI (board, lobby, setup, overlays)
  art/             Original SVG scenes, emblems, avatars, glyphs
  themes.ts        The park theme registry  ← add a park here
  assets/          Raster art (park scenes, character portraits, audio, sfx)
supabase/          Schema migration + the `game` Edge Function (optional backend)
docs/              Architecture, theming, Supabase, deployment guides
```

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the pure engine,
  reducer, transports, and authority fit together (and how hidden information is
  enforced).
- **[docs/THEMES.md](docs/THEMES.md)** — **add your own national park theme.**
  Contributions welcome and encouraged!
- **[docs/SUPABASE.md](docs/SUPABASE.md)** — set up the optional multiplayer
  backend (with a one‑command helper script).
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — deploy the static build to any host.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev workflow, tests, conventions.

## How to play

Open the in‑app **Learn to Play** for a full tutorial, or
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the terminology
(Turn → Round → Deal → Game). In short: each turn you draw one card and discard
one, always holding three; collect the highest total you can in a single suit;
knock to end the deal; lowest hand loses a token; last player with a token wins.

## Tech

React 18 · TypeScript · Vite 6 · plain CSS · Supabase (optional, for
multiplayer) · Vitest. No game‑logic dependencies — the rules are pure,
serializable TypeScript shared by the client and the server.

## Credits & license

Original artwork is inspired by the public‑domain visual language of 1930s WPA
national‑park posters; no copyrighted poster art is used. Sound effects (if
added) should be CC0/public‑domain — see `src/assets/sfx/README.md`.

Licensed under the [MIT License](LICENSE).
