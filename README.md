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
| Online | Friends on their own devices, real-time or async | Free Azure **or** Supabase backend |

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
git clone git@github.com:randalrausch/31-parks-edition.git
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

Online play needs two things: a **static host** for the site and a **backend**
for the authoritative game server. The app auto-selects a backend from
environment variables, so you can pick whichever you prefer — **you don't need
all of them**:

| Backend | Set these env vars | Host pairing | Guide |
|---------|--------------------|--------------|-------|
| **Azure** (Functions + Table Storage) | `VITE_API_BASE` | Azure Static Web Apps | [docs/AZURE.md](docs/AZURE.md) |
| **Supabase** (Edge Function + Postgres) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | Netlify / Vercel / any static host | [docs/SUPABASE.md](docs/SUPABASE.md) |

If both are configured, **Azure wins**; if neither is set, the site still builds
and serves **solo + pass-and-play** (the online buttons hide). The server is
authoritative and enforces hidden hands either way.

- **Azure** is the lowest-maintenance choice — everything scales to zero and
  **auto-wakes after long gaps with no manual un-pausing**. One command:
  `azd up` (or `npm run azure:up`). See [docs/AZURE.md](docs/AZURE.md).
- **Supabase + a static host** (Netlify/Vercel/Azure SWA/Cloudflare) also works;
  note a free Supabase project **pauses after 7 days idle** and must be un-paused
  from its dashboard. See [docs/SUPABASE.md](docs/SUPABASE.md) and
  [docs/DEPLOY.md](docs/DEPLOY.md).

## Scripts

`npm` is the single entry point for every target — no Makefile needed.

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server (solo/pass-and-play; online if env vars set) |
| `npm run build` | Type-check and build a static bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit + fuzz test suite (Vitest) |
| `npm run typecheck` | Type-check only |
| **Azure backend** | |
| `npm run api:install` / `api:build` / `api:test` | Install / bundle / test the Functions app (`api/`) |
| `npm run api:start` | Run the Functions host locally (`func start`) |
| `npm run dev:online:azure` | SWA CLI: Vite + local `/api` proxy (online dev) |
| `npm run azure:up` | `azd up` — provision + deploy the whole Azure stack |
| `npm run azure:deploy` | Build the api and `azd deploy` |
| **Supabase backend** | |
| `npm run build:edge` | Re-bundle the shared engine for the Supabase Edge Function |
| `npm run supabase:setup` | One-command Supabase project setup |
| `npm run supabase:deploy` | Bundle the engine + deploy the `game` Edge Function |
| `npm run supabase:push` | Apply DB migrations |
| **Static hosting** | |
| `npm run netlify:deploy` | Build and upload `dist/` to Netlify |

**Automated deploys (GitHub Actions):** the existing **Netlify + Supabase**
pipeline runs on push to `main` (see [docs/DEPLOY.md](docs/DEPLOY.md)). The
**Azure** workflow (`.github/workflows/azure.yml`) is **opt-in** — set the repo
variable `DEPLOY_AZURE=true` to enable it (full setup in
[docs/AZURE.md](docs/AZURE.md)). They don't interfere with each other.

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
api/               Azure Functions backend — the authority (optional Azure path)
supabase/          Schema migration and the `game` Edge Function (optional Supabase path)
infra/             Bicep for the Azure backend (`azd up`)
docs/              Architecture, theming, backend, and deployment guides
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pure engine, reducer,
  transports, and authority fit together, and how hidden information is enforced.
- [docs/THEMES.md](docs/THEMES.md) — how to add your own national park theme.
  Contributions are welcome.
- [docs/AZURE.md](docs/AZURE.md) — the optional **Azure** backend (Functions +
  Table Storage + Static Web Apps) via one `azd up`; scales to zero and auto-wakes.
- [docs/SUPABASE.md](docs/SUPABASE.md) — the optional **Supabase** backend
  (Edge Function + Postgres) with a one-command helper script.
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

React 19, TypeScript, Vite 8, plain CSS, Supabase (optional, for multiplayer),
and Vitest. There are no game-logic dependencies; the rules are pure,
serializable TypeScript shared by the client and the server.

## Credits and license

Original artwork is inspired by the public-domain visual language of 1930s WPA
national-park posters; no copyrighted poster art is used. The bundled sound
effects are CC0/public-domain samples (with a synthesized fallback); any
replacements should also be CC0 (see `src/assets/sfx/README.md`).

Licensed under the [MIT License](LICENSE).
