# 31 · National Parks Edition

A vintage WPA-poster-styled implementation of the classic card game **31**. Play
solo against AI opponents, pass-and-play with friends on one device, or online
across devices. It's a self-contained React + TypeScript + Vite app; an optional
Supabase backend adds real-time, asynchronous online play.

> Build the highest hand you can in a single suit, as close to 31 as possible.
> Knock when you're confident; each deal the lowest hand loses a token. The last
> player holding a token wins.

## Three ways to play

| Mode | Players | Setup |
|------|---------|-------|
| Solo vs AI | You and AI opponents | None |
| Pass-and-play | 2–8 humans sharing one device (with "pass the device" hidden-hand screens) | None |
| Online | Friends on their own devices, real-time or async | Free Supabase project |

Two of the three modes, including local multiplayer, run with no configuration.
Supabase is only needed for online play across devices.

## Features

- A complete game of 31: draw/discard/knock, Grace, knock penalty, instant 31,
  elimination, and an end-of-game score chart.
- Pass-and-play for 2–8 humans on one device, with cover screens between turns so
  nobody sees another player's hand.
- 10 AI opponents with distinct, trait-driven personalities (bluff, memory,
  patience, aggression, risk).
- Themed national parks (Glacier, Yellowstone, Theodore Roosevelt) with original
  WPA-style art, and a one-file path to add your own (see below).
- Optional online multiplayer: server-authoritative and asynchronous. Take your
  turn whenever; the saved game waits for you.
- Installable as a PWA, and playable offline for solo games.
- Pure game logic covered by unit and fuzz tests, with CI on every push.

## Running it: from local to online

There are two levels: run it locally, and when you're ready, put it online.

### 1. Run it locally (no setup)

Requires Node 20+.

```bash
git clone https://github.com/<you>/31-parks-edition.git
cd 31-parks-edition
npm install
npm run dev          # http://localhost:5173
```

Solo vs. AI and local pass-and-play work immediately, with no configuration and
no accounts. On the home screen, choose how many humans and AI opponents to seat
and start the game; with two or more humans you pass the device between turns
with hidden-hand cover screens.

To play the optimized production build locally instead of the dev server:

```bash
npm run build && npm run preview
```

### 2. Put it online

For a shareable URL and online play across devices, deploy the static build to a
web host and connect a free Supabase project:

- Host the site. `npm run build` produces a static site in `dist/` that runs on
  any static host. Step-by-step guides for Azure Static Web Apps, Netlify, and
  Vercel, including pointing your own custom domain at it, are in
  [docs/DEPLOY.md](docs/DEPLOY.md).
- Enable online multiplayer. Create a free Supabase project (real-time,
  asynchronous play; the server is authoritative and enforces hidden hands). A
  helper script sets it up: see [docs/SUPABASE.md](docs/SUPABASE.md).

You can host the site without Supabase as well; visitors then get solo and
pass-and-play on a public URL. Supabase is only what enables online,
cross-device games.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build a static bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit and fuzz test suite (Vitest) |
| `npm run test:watch` | Watch-mode tests |
| `npm run typecheck` | Type-check only |
| `npm run build:edge` | Re-bundle the shared engine for the Supabase Edge Function |

## Project structure

```text
src/
  game/            Framework-free game core (engine, reducer, AI, transports)
    engine.ts        Rules: scoring, tokens/grace, AI trait-to-behaviour mappings
    actions.ts       Pure reducer: applyAction(state, action) — the authority
    authority.ts     Server brain: redactState / advanceAuthority / applyPlayerAction
    useGame.ts       Solo presentation layer over the reducer (animation, AI, sound)
    transport.ts     Transport interface + LocalTransport
    networkTransport.ts / useNetworkGame.ts   Online sync over Supabase
    *.test.ts        Unit and fuzz tests
  components/       React UI (board, lobby, setup, overlays)
  art/             Original SVG scenes, emblems, avatars, glyphs
  themes.ts        The park theme registry  (add a park here)
  assets/          Raster art (park scenes, character portraits, audio, sfx)
supabase/          Schema migration and the `game` Edge Function (optional backend)
docs/              Architecture, theming, Supabase, and deployment guides
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pure engine, reducer,
  transports, and authority fit together, and how hidden information is enforced.
- [docs/THEMES.md](docs/THEMES.md) — how to add your own national park theme.
  Contributions are welcome.
- [docs/SUPABASE.md](docs/SUPABASE.md) — set up the optional multiplayer backend
  with a one-command helper script.
- [docs/DEPLOY.md](docs/DEPLOY.md) — deploy the static build to any host.
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev workflow, tests, and conventions.

## How to play

Open the in-app "Learn to Play" for a full tutorial, or see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the terminology
(Turn, Round, Deal, Game). In short: each turn you draw one card and discard one,
always holding three; collect the highest total you can in a single suit; knock
to end the deal; the lowest hand loses a token; the last player with a token
wins.

## Tech

React 18, TypeScript, Vite 6, plain CSS, Supabase (optional, for multiplayer),
and Vitest. There are no game-logic dependencies; the rules are pure,
serializable TypeScript shared by the client and the server.

## Credits and license

Original artwork is inspired by the public-domain visual language of 1930s WPA
national-park posters; no copyrighted poster art is used. The bundled sound
effects are CC0/public-domain samples (with a synthesized fallback); any
replacements should also be CC0 (see `src/assets/sfx/README.md`).

Licensed under the [MIT License](LICENSE).
