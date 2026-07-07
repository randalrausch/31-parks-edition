---
name: deploy-netlify
description: Build and deploy "31 National Parks Edition" to Netlify. Use when the user wants to publish, ship, push, or deploy the site to Netlify (production). Builds locally, uploads the prebuilt dist via the Netlify CLI, and verifies the live bundle matches what was built before reporting success.
---

# Deploy 31: National Parks Edition to Netlify

Publishes the site to the **already-linked** Netlify site. This is a static Vite SPA —
no server, functions, or env secrets are required.

## Facts about this project

- **Project root:** `/Users/randyrausch/Desktop/31-parks-edition`
- **Linked siteId:** `7c9c3bd2-2670-4be3-84dc-91c417aae08b` (source of truth: `.netlify/state.json`)
- **Build command:** `npm run build` (`tsc -b && vite build`) → outputs to `dist/`
- **Redirects:** committed `public/_redirects` (copied into `dist/` by Vite) handles the
  SPA fallback **and** forces missing `/assets/*` to 404 instead of masking them as HTML.
- **Deploy account:** Randy Rausch, team Owner (Netlify CLI is authenticated).

## Why the CLI, not the MCP

The Netlify **MCP** `deploy-site` tool was proven (2026-06-28) to report `ready` while
**NOT publishing the local `dist/`** — the site kept serving a stale build. So this skill
uploads the prebuilt output with the **Netlify CLI** (`netlify deploy --prod --dir=dist`),
which actually uploads local files, and then **verifies the live bundle hash** before
claiming success. Do not switch back to the MCP for deploying.

## Procedure

Run in order. Stop and report if any step fails — never claim success without the
hash check in step 5 passing.

### 1. Read the live siteId (don't hardcode)

Read `.netlify/state.json` and use its `siteId`. If missing, the project isn't linked —
stop and tell the user to link it (`netlify link`) rather than guessing.

### 2. Build locally (the pre-flight gate)

```bash
npm run build
```

Must succeed and produce `dist/index.html`. If `tsc` or `vite build` errors, surface the
output and **do not proceed** — fixing the build is the user's call. Then capture the
built bundle hash for the integrity check:

```bash
test -f dist/index.html || { echo "dist MISSING"; exit 1; }
BUILT=$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1)
echo "built bundle: $BUILT"
```

Also confirm the redirects came through: `dist/_redirects` should exist (from
`public/_redirects`). If it's missing, the SPA fallback / asset-404 guard won't apply.

### 3. Deploy via the portable npm script

The canonical deploy command lives in `package.json` (one source of truth, also used by
CI and by contributors). It builds and uploads the prebuilt `dist/`:

```bash
npm run deploy:web
```

This runs `npm run build` then `netlify-cli deploy --prod --dir=dist` against the linked
site (`.netlify/state.json`). Capture the **Unique deploy URL**
(`https://<deployId>--31game.netlify.app`) from the output for the integrity check.

Note: step 2's standalone build already produced `$BUILT`; `deploy:web` rebuilds (same
output) and uploads it.

### 4. (Optional) Confirm deploy state

The CLI prints "Deploy is live!" on success. If you want the API view, read it with the
deploy reader or `netlify api getSiteDeploy`.

### 5. Integrity check — REQUIRED before reporting success

A deploy that says "ready"/"live" is NOT proof the live site serves your build. Verify the
live bundle hash matches the one built in step 2, and that redirects behave:

```bash
LIVE=$(curl -s "https://31game.netlify.app/?cb=$(date +%s)" -H 'Cache-Control: no-cache' \
  | grep -o 'assets/index-[^"]*\.js' | head -1)
echo "built: $BUILT"
echo "live : assets/$LIVE  (must equal built)"

curl -s -o /dev/null -w "deep route    -> %{http_code} (expect 200)\n" "https://31game.netlify.app/online/xyz"
curl -s -o /dev/null -w "missing asset -> %{http_code} (expect 404)\n" "https://31game.netlify.app/assets/does-not-exist-123.js"
```

- **If the live hash ≠ built hash:** the deploy did NOT publish your files. Do NOT report
  success. Investigate (CDN propagation lag, wrong site, or the deploy tool not uploading).
- **If they match** and redirects behave (deep route 200, missing asset 404): report the
  live URL + deploy permalink to the user.

## Notes

- Deploys to the **existing** linked site — updates it, never creates a new one. A new site
  must be explicit.
- If the CLI reports an auth error, run `npx netlify-cli login` (interactive) or check
  `~/Library/Preferences/netlify/config.json`.
- Deploying the **prebuilt `dist/`** means Netlify does no server-side build, so a
  Linux-vs-macOS environment difference can't break the deploy. The local `npm run build`
  in step 2 is the only build, and it's the gate.
