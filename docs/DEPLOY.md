# Deploying

The app is a **plain static site**. `npm run build` emits everything to `dist/`
— deploy that folder to any static host. There's no server to run (online
multiplayer, if enabled, talks to Supabase directly).

```bash
npm run build      # → dist/
```

## What every host needs

1. **Build command:** `npm run build`  ·  **Publish/output directory:** `dist`
2. **SPA fallback:** serve `index.html` for unknown routes (so deep links and
   refresh work). Per‑host setting below. (An Azure `staticwebapp.config.json`
   and a Netlify/Cloudflare `_redirects` are already included.)
3. **(Online multiplayer only)** set these **build‑time** environment variables
   — they're embedded into the bundle when the host runs `npm run build`, so they
   must exist at build time:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_KEY`

   Omit them and the site still builds — visitors just get solo + pass‑and‑play
   (the online buttons are hidden). See [SUPABASE.md](SUPABASE.md) to create the
   project and keys.

> These two values are client‑safe (the publishable/anon key is public, guarded
> by RLS). Never put the `service_role` key in the web build.

---

## Azure Static Web Apps

Free tier, deploys from GitHub, custom domains included.

1. In the [Azure Portal](https://portal.azure.com), create a **Static Web App**.
   Connect your GitHub repo and branch (`main`).
2. Build details:
   - **Build Presets:** Custom (or Vite)
   - **App location:** `/`
   - **Output location:** `dist`
   Azure commits a GitHub Actions workflow to your repo that builds and deploys
   on every push.
3. **SPA routing** is already handled by `public/staticwebapp.config.json`
   (it ships in `dist/`), so deep links work with no extra setup.
4. **Online multiplayer env vars:** add `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY`
   so they're present at build time. Either add them to the generated workflow's
   build step `env:`, e.g.:
   ```yaml
   - name: Build And Deploy
     uses: Azure/static-web-apps-deploy@v1
     env:
       VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
       VITE_SUPABASE_KEY: ${{ secrets.VITE_SUPABASE_KEY }}
     with: { ... }
   ```
   (define those as GitHub repo **Secrets**), or build in CI and use the
   "bring your own" deploy.

**Custom domain:** Static Web App → **Custom domains** → **Add**. For an apex
domain (`example.com`) Azure gives you an `ALIAS`/`A` record + a `TXT` validation
record; for a subdomain (`play.example.com`) add the `CNAME` Azure shows to your
DNS provider. HTTPS certificates are issued and renewed automatically.

## Netlify

A `netlify.toml` and `public/_redirects` are included (build `npm run build`,
publish `dist`, SPA redirect configured).

1. **Add new site → Import from Git**, pick the repo. Settings are auto‑detected.
2. **Environment variables** (Site settings → Environment variables): add
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` for online play, then redeploy.

**Custom domain:** Site → **Domain management** → **Add a domain**. Point your
DNS there — either delegate your domain to Netlify DNS, or add the `CNAME` (for a
subdomain) / `A`/`ALIAS` (for the apex) Netlify shows. TLS is automatic.

## Vercel

1. **Add New → Project**, import the repo. Framework preset **Vite**
   (build `npm run build`, output `dist`).
2. Add a SPA rewrite — commit `vercel.json` at the repo root:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
3. **Environment Variables** (Project → Settings): add `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_KEY`.

**Custom domain:** Project → **Settings → Domains → Add**. Add the `A` record
(apex) or `CNAME` (subdomain) Vercel shows to your DNS provider; certificates are
automatic.

## Other hosts (Cloudflare Pages, GitHub Pages, S3/nginx)

- **Cloudflare Pages:** build `npm run build`, output `dist`; the bundled
  `_redirects` provides the SPA fallback. Add the env vars under the project's
  settings; custom domains under **Custom domains**.
- **GitHub Pages:** publish `dist/`; for SPA routing copy `index.html` to
  `404.html` after building. If serving from a sub‑path, set Vite's `base` in
  `vite.config.ts`. Custom domain via a `CNAME` file / repo settings.
- **Any static server / S3 / nginx:** upload `dist/` and configure a fallback to
  `/index.html` for unmatched paths.

## PWA / install

The build includes a web manifest, icons, and a service worker, so the deployed
site is installable (iOS: Share → **Add to Home Screen**; desktop Chrome: the
install icon) and works offline for solo play. The service worker registers only
on the production build over HTTPS (localhost counts as secure for testing).

## Updating online multiplayer after deploy

The web app and the Supabase backend deploy independently. If you change shared
game logic, redeploy the Edge Function too:

```bash
npm run build:edge && supabase functions deploy game
```

See [SUPABASE.md](SUPABASE.md).
