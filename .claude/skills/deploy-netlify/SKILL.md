---
name: deploy-netlify
description: Build and deploy "31 National Parks Edition" to Netlify. Use when the user wants to publish, ship, push, or deploy the site to Netlify (production). Runs the local Vite build first as a pre-flight gate, then triggers the Netlify MCP deploy against the linked site.
---

# Deploy 31: National Parks Edition to Netlify

Publishes the site to the **already-linked** Netlify site via the Netlify MCP server.
This is a static Vite SPA — no server, functions, or env secrets are required.

## Facts about this project

- **Project root:** `/Users/randyrausch/Desktop/31-parks-edition`
- **Linked siteId:** `7c9c3bd2-2670-4be3-84dc-91c417aae08b` (source of truth: `.netlify/state.json`)
- **Build command:** `npm run build` (`tsc -b && vite build`) → outputs to `dist/`
- **Config:** `netlify.toml` sets `publish = "dist"` and an SPA fallback redirect (`/* → /index.html`)
- **Deploy account:** Randy Rausch, team Owner (verified via Netlify MCP)

## Procedure

Run these steps in order. Stop and report if any step fails — never deploy a broken build.

### 1. Read the live siteId (don't hardcode)

Read `.netlify/state.json` and use its `siteId`. If the file is missing, the project
isn't linked — stop and tell the user to link it (`netlify link`) rather than guessing.

### 2. Build locally (the pre-flight gate)

```bash
npm run build
```

This must succeed and produce a non-empty `dist/` directory. If `tsc` or `vite build`
errors, surface the output and **do not proceed** — fixing the build is the user's call.
Verify with:

```bash
test -f dist/index.html && echo "dist OK" || echo "dist MISSING"
```

### 3. Deploy via the Netlify MCP

Call the `mcp__netlify__netlify-deploy-services-updater` tool:

```json
{
  "selectSchema": {
    "operation": "deploy-site",
    "params": {
      "deployDirectory": "/Users/randyrausch/Desktop/31-parks-edition",
      "siteId": "<siteId from step 1>"
    }
  }
}
```

Use the **project root** as `deployDirectory` (not `dist/`) so Netlify picks up
`netlify.toml` — that's what applies the SPA redirect and the `publish = "dist"` setting.
The local build in step 2 is the safety gate; Netlify builds from the toml on its side.

### 4. Confirm

Report the resulting deploy URL / status back to the user. Optionally verify with the
deploy reader (`mcp__netlify__netlify-deploy-services-reader`, `get-deploy-for-site`).

## Notes

- This deploys to the **existing** linked site — it updates it, never creates a new one.
  If the user wants a new site, that must be explicit.
- If the MCP returns an auth error, the token/session has expired — reconnect the
  netlify MCP via `/mcp` and retry.
