# 31 · National Parks Edition

A fast classic card game reimagined with the wonder of America's wild places — a
vintage **WPA-poster**-inspired front-end prototype.

Built with **React + TypeScript + Vite** and plain CSS modules. No backend, no
database, no paid APIs. Deploys directly to Netlify's free tier.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # type-checks, then emits a static bundle to ./dist
npm run preview  # serve the production build locally
```

## Deploy to Netlify

Push to GitHub and connect the repo, or drag the `dist/` folder onto Netlify.
Build settings are pre-configured in `netlify.toml` (`npm run build` → `dist`).

## Targets

iPad-first and touch-optimized, responsive down to iPhone and up to laptop/
desktop. Uses `dvh` units and safe-area insets so the immersive table extends
cleanly under the iOS notch and home indicator.

## Architecture

The game logic is intentionally **mocked** — deterministic sample data so the UI
always looks presentation-ready. Search for `TODO:` comments to find the seams
where real game logic, multiplayer, auth, matchmaking, and score persistence
would be wired in.

### Themes

Each national park is a self-contained entry in `src/themes.ts`. **Glacier** and
**Yellowstone** are fully implemented; the registry is built so adding any other
park (Yosemite, Zion, Grand Canyon, Acadia, …) is a single new entry — palette,
scene component, tagline, avatars, and victory copy — and it appears
automatically in the in-game Park Picker.

### Components

`App` · `PromoLanding` · `GameBoard` · `ParkThemeProvider` · `ParkBackground` ·
`Card` · `CardBack` · `PlayerSeat` · `CenterPiles` · `Controls` · `Scoreboard` ·
`ThemeToggle` (Park Picker) · `HelpPanel` · `VictoryPanel`
