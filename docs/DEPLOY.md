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

## Deploy commands (any machine)

The repo ships portable npm scripts so you never need a special tool or this
project's CI to deploy. They read configuration from the environment (and your
local `supabase link` / `netlify link` state) — no IDs are hardcoded.

| Command | What it does |
|---------|--------------|
| `npm run supabase:push` | Apply pending DB migrations to the linked Supabase project |
| `npm run supabase:deploy` | Re-bundle the engine and deploy the `game` Edge Function |
| `npm run netlify:deploy` | Build the site and upload the prebuilt `dist/` to Netlify |
| `npm run azure:up` | Provision + deploy the whole **Azure** backend (`azd up`) |

The Supabase/Netlify commands shell out to `supabase` / `netlify-cli` via `npx`,
so contributors who only run the game locally don't pay for those CLIs. To target
a specific Netlify site without an interactive `netlify link`, set
`NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` in your environment. For the Azure
backend instead, see [AZURE.md](AZURE.md).

## Automated deploys (GitHub Actions)

`.github/workflows/ci.yml` is a single CI/CD pipeline:

- **Every push and PR:** type-check, tests, the edge-bundle sync check, and a
  production build (the quality gate).
- **Push to `main` only:** it then deploys — **backend first** (only when
  `supabase/**` changed), then the frontend, then a smoke check.

Two deliberate free-tier choices live in that workflow:

- **The site is built in Actions and the prebuilt `dist/` is uploaded to
  Netlify**, so Netlify spends **zero** of its 300 free build-minutes/month.
  GitHub Actions minutes are free for public repos.
- **The Supabase backend deploys only when `supabase/**` changed**, so a CSS
  tweak doesn't redeploy the Edge Function or touch the database.

### Deploy your own (one-time setup)

1. Fork/clone the repo and create your own free **Supabase** project
   (see [SUPABASE.md](SUPABASE.md)) and **Netlify** site.
2. In your GitHub repo, add these under
   **Settings → Secrets and variables → Actions → Secrets**:

   | Secret | Where to get it |
   |--------|-----------------|
   | `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → **New access token** |
   | `NETLIFY_SITE_ID` | Netlify → Site configuration → **Site ID** (API ID) |
   | `SUPABASE_ACCESS_TOKEN` | Supabase → Account → **Access Tokens** |
   | `SUPABASE_PROJECT_REF` | The `<ref>` in `https://<ref>.supabase.co` |
   | `SUPABASE_DB_PASSWORD` | The database password you set when creating the project |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` (baked into the web build) |
   | `VITE_SUPABASE_KEY` | Supabase → Project Settings → API → **publishable/anon** key |

   Optionally add a **Variable** (not a secret) `SITE_URL` =
   `https://your-site.netlify.app` to enable the post-deploy smoke check.

3. Push to `main`. CI builds and deploys; subsequent pushes auto-deploy.

> **Supabase free-tier caveat:** a free project is **paused after 7 days of
> inactivity**. If your online demo stops working, un-pause it from the Supabase
> dashboard (or upgrade). Solo and pass-and-play never depend on Supabase.

> **Never put the `service_role` key in GitHub secrets used by the web build or
> in any `VITE_` variable** — only the publishable/anon key is client-safe.

## PWA / install

The build includes a web manifest, icons, and a service worker, so the deployed
site is installable (iOS: Share → **Add to Home Screen**; desktop Chrome: the
install icon) and works offline for solo play. The service worker registers only
on the production build over HTTPS (localhost counts as secure for testing).

## Updating online multiplayer after deploy

The web app and the backend deploy independently. If you change shared game
logic, redeploy the backend too:

```bash
npm run supabase:deploy   # Supabase: re-bundle the engine + deploy the game function
# or, on Azure:
npm run azure:deploy      # build the api + azd deploy
```

If automated deploys are set up (above), pushing to `main` does this for you. See
[SUPABASE.md](SUPABASE.md) or [AZURE.md](AZURE.md).
