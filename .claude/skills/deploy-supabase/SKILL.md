---
name: deploy-supabase
description: Push the Supabase backend for "31 National Parks Edition" — database migrations and the 'game' edge function. Use when the user wants to deploy, push, or ship backend/Supabase changes (schema/migrations, edge functions, the multiplayer server). Separate from the frontend (see deploy-netlify).
---

# Deploy 31: National Parks Edition — Supabase backend

Pushes the **backend** to the linked Supabase project. This is independent of the Netlify
frontend deploy — the static site and the Supabase backend ship separately.

## Facts about this project

- **Project root:** `/Users/randyrausch/Desktop/31-parks-edition`
- **Linked project ref:** `phlkhbqfyblmexvmhdtw` (config `project_id = "31-parks"`; source of
  truth: `supabase/.temp/project-ref` / `supabase/config.toml`).
- **Migrations:** `supabase/migrations/*.sql`
- **Edge function:** `supabase/functions/game/` — its `index.ts` imports
  `_shared/engine.mjs`, which is **generated** from app source via `npm run build:edge`
  (`esbuild src/game/edgeEntry.ts → supabase/functions/_shared/engine.mjs`).
- **CI does NOT deploy Supabase.** `.github/workflows/ci.yml` only verifies that
  `engine.mjs` is in sync with source. Backend pushes are manual via this skill.
- The Supabase CLI is authenticated; `npx supabase` works without a global install.

## Procedure

Run in order. Stop and report if any step fails.

### 1. Regenerate + verify the edge engine bundle

`engine.mjs` must reflect the latest game source, and must be committed (CI enforces this):

```bash
npm run build:edge
git diff --quiet -- supabase/functions/_shared/engine.mjs \
  && echo "engine.mjs in sync" \
  || { echo ">>> engine.mjs changed — commit it before deploying"; git --no-pager diff --stat -- supabase/functions/_shared/engine.mjs; }
```

If it changed, surface that to the user and let them commit (don't silently commit for them).

### 2. Check migration drift (local vs remote)

```bash
npx -y supabase migration list --linked
```

- Every **Local** migration should have a matching **Remote** entry. If a local migration is
  missing on Remote, it hasn't been pushed yet → step 3.
- If Remote has migrations Local doesn't, STOP and report — local is behind; do not push.

### 3. Deploy the backend via the portable npm scripts

The canonical commands live in `package.json` (same ones CI and contributors use):

```bash
npm run deploy:backend      # = db:push  then  build:edge + functions deploy game
```

Or run the halves individually:
- `npm run db:push` — apply pending migrations (skip/no-op if already in sync).
- `npm run deploy:edge` — re-bundle the engine and deploy the `game` function.

A "Docker is not running" warning during the function deploy is harmless — the CLI bundles
remotely instead.

### 5. Verify — REQUIRED before reporting success

```bash
# Migrations back in sync:
npx -y supabase migration list --linked
# Function version bumped (proves the new source is live):
npx -y supabase functions list 2>&1 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d.split('\n').find(l=>l.trim().startsWith('{')));const f=j.functions.find(x=>x.slug==='game');console.log('game: status='+f.status+' version='+f.version+' updated='+new Date(f.updated_at).toISOString());}catch(e){console.log(d)}})"
```

Report to the user:
- migrations in sync (local == remote), and
- the new function **version number** + updated timestamp (it should be higher than before).

Only claim success once the function version has bumped and migrations are in sync.

## Notes

- Deploys to the **existing** linked project — never creates a new one.
- If the CLI reports auth errors, the access token expired: `npx supabase login`.
- This skill does NOT touch the frontend. To publish the site, use **deploy-netlify**.
- A full release is usually: backend first (`deploy-supabase`), then frontend
  (`deploy-netlify`), so the deployed UI never calls a function/schema that isn't live yet.
