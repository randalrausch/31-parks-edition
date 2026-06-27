# Deploying

The app is a **plain static site**. `npm run build` emits everything to `dist/`
— deploy that folder to any static host. There's no server to run (multiplayer,
if enabled, talks to Supabase directly).

```bash
npm run build      # → dist/
```

## Two things every host needs

1. **Publish directory:** `dist`  ·  **Build command:** `npm run build`
2. **SPA fallback:** serve `index.html` for unknown routes (so deep links and
   refresh work). The per‑host setting is below.
3. **(Multiplayer only)** set these **build‑time** environment variables — they
   are embedded into the bundle at build time, so they must be present when the
   host runs `npm run build`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_KEY`

   Omit them and the app builds as **solo‑only** (online buttons are hidden).

> These two values are client‑safe (the publishable/anon key is public, guarded
> by RLS). Never put the `service_role` key in the web build.

## Host recipes

### Netlify
A `netlify.toml` and `public/_redirects` are included as a convenience (build =
`npm run build`, publish = `dist`, SPA redirect configured). Connect the repo,
or `netlify deploy --prod`. Set the env vars under **Site settings →
Environment variables**.

### Vercel
Framework preset: **Vite**. Build `npm run build`, output `dist`. Add a rewrite
so routing works — `vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
Set the env vars under **Project → Settings → Environment Variables**.

### Cloudflare Pages
Build command `npm run build`, output directory `dist`. Add a `public/_redirects`
line (already present) — Cloudflare honors it: `/*  /index.html  200`. Set env
vars under **Settings → Environment variables**.

### GitHub Pages
Build, then publish `dist/` (e.g. via an Actions workflow or `gh-pages`). For SPA
routing on Pages, copy `index.html` to `404.html` in `dist/` after building.
If serving from a sub‑path, set Vite's `base` in `vite.config.ts` accordingly.

### Any static host / S3 / nginx
Upload `dist/`. Configure the server to fall back to `/index.html` for paths that
don't match a file (the SPA fallback).

## PWA / install

The build includes a web manifest, icons, and a service worker, so the deployed
site is installable (iOS: Share → **Add to Home Screen**; desktop Chrome: the
install icon) and works offline for solo play. The service worker only registers
on the production build over HTTPS (localhost counts as secure for testing).

## Updating multiplayer after deploy

The web app and the Supabase backend deploy independently. If you change shared
game logic, redeploy the Edge Function too:
```bash
npm run build:edge && supabase functions deploy game
```
See [SUPABASE.md](SUPABASE.md).
