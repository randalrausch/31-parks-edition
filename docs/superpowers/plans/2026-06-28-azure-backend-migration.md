# Azure Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase backend (Postgres + Deno edge function + Realtime) with an Azure backend — a standalone Azure Functions app (Consumption) behind Azure Static Web Apps (Free) for the static site, backed by Azure Table Storage with managed-identity access — and make the whole thing one-command provisionable for open-source users, to an "example of excellence" standard.

**Architecture:** Online play sits behind one TypeScript interface, `GameApi` (5 ops: `create`, `join`, `start`, `act`, `state`). We port the authority into a **standalone Azure Functions app** (Node 20 / TypeScript, Consumption plan) exposing `POST /api/game`, reached cross-origin (CORS) from the SWA-hosted SPA. State lives in **Azure Table Storage**, accessed via **managed identity** (no secrets). Public lobby state and the secret authoritative state are two rows in **one table under the same partition key**, updated together with an **atomic batch transaction** (ETag CAS) so a game can never half-commit. Realtime is replaced by the client polling that already exists. A **timer-triggered function reaps abandoned games**. **Application Insights** gives traces and cold-start visibility. The pure engine (`engine.mjs`) is reused unchanged. Infrastructure is Bicep, provisioned with `azd up` (plus a "Deploy to Azure" button).

**Tech Stack:** Azure Static Web Apps (Free, static only), Azure Functions (Node 20 / TypeScript, Consumption, HTTP + timer triggers), Azure Table Storage via `@azure/data-tables` + `@azure/identity` (`DefaultAzureCredential`), Application Insights, Azurite + Static Web Apps CLI (`swa`) + Functions Core Tools for local dev, Bicep + `azd` for provisioning, GitHub Actions (`Azure/static-web-apps-deploy` + `Azure/functions-action`, or `azd`) for CD, Vite/React/TypeScript frontend, Vitest.

## Global Constraints

- **Preserve the `GameApi` contract verbatim** (see "Reference: GameApi contract"). The React UI, `useNetworkGame`, `OnlineSession`, and components change only their imports.
- **Server stays authoritative.** `redactState(state, seatId)` runs before every state response; secrets never leave the server un-redacted. This is enforced by a property test (Phase 5).
- **No secrets for data access.** The Function App reaches Table Storage via **managed identity** (RBAC: *Storage Table Data Contributor*), not connection strings, in the cloud. Local dev uses Azurite.
- **Atomic state writes.** The public + secret rows share one partition and commit via a single Table Storage **batch transaction** with ETag CAS. No cross-entity write is ever non-atomic.
- **Online stays optional.** The SPA enables online only when `VITE_API_BASE` is set (the Function App URL). A static-only host leaves it empty → solo + pass-and-play only.
- **Node 20** everywhere. **Free-tier only by default**; document any cost; recommend a Budget alert.
- **DRY / YAGNI / TDD**, one commit per task, `engine.mjs` kept CI-verified in sync with source.

## Non-Goals (deliberate scope discipline)

Documented so the restraint is intentional: no API Management / WAF / Front Door; no Azure SignalR or push realtime (the game is async — polling suffices); no user accounts / auth providers (per-seat tokens are the auth); no multi-region or HA; no rate-limiting *infrastructure* beyond a lightweight per-IP create cap + game TTL. These are revisited only if the project outgrows family/community scale.

---

## Reference: GameApi contract (must be preserved)

```typescript
interface GameApi {
  create(config: CreateConfig): Promise<{ gameId: string; code: string; seatIndex: number; seatToken: string }>;
  join(code: string, name: string): Promise<{ gameId: string; seatIndex: number; seatToken: string }>;
  start(gameId: string, seatToken: string): Promise<void>;
  act(gameId: string, seatToken: string, action: GameAction): Promise<void>;
  state(gameId: string, seatToken?: string): Promise<{
    status: string; version: number; seats: SeatInfo[]; seatIndex: number | null; state: GameState;
  }>;
}
```

Wire envelope (POST JSON to `${VITE_API_BASE}/game`), identical to today's Supabase function:
- `create` → `{ gameId, code, seatIndex:0, seatToken }`
- `join` → `{ gameId, seatIndex, seatToken }`
- `start` → `{ ok:true }` (403 if not host)
- `act` → `{ ok:true }` | `{ ok:false, reason:"not-applied" }` | HTTP 409 (message contains `retry`)
- `state` → `{ status, version, seats, seatIndex, state }` (state redacted per seat)

Engine functions reused unchanged from `engine.mjs`: `createGameState`, `applyAction`, `applyPlayerAction`, `advanceAuthority`, `redactState`.

---

## Data model (Azure Table Storage)

**One data table, atomic per-game writes.**

1. **`Games`** — both rows share `PartitionKey = gameId`:
   - Row `RowKey = "game"` (public lobby): `code`, `status`, `version` (int32, client-visible change counter), `seats` (JSON), `createdAt`, `updatedAt`, `expiresAt` (datetime — for TTL).
   - Row `RowKey = "secret"` (never client-readable): `state` (JSON `GameState`, <60 KB — guarded), `seatTokens` (JSON `{ [token]: seatIndex }`).
   - **Updates to both rows go in one `submitTransaction` batch**, with the `"game"` row carrying the ETag gate. ETag mismatch → 409 `retry`.

2. **`GameCodes`** — code→gameId index (`PartitionKey = RowKey = code`, prop `gameId`). Separate partition (can't share the batch); written **before** the game on create. A rare orphaned index entry is harmless and reaped by TTL.

`expiresAt` (e.g. `createdAt + 14 days`, refreshed on each `act`) drives the cleanup timer (Phase 6).

---

## File Structure

```bash
api/                              # standalone Azure Functions app (new)
  package.json                    # @azure/functions, @azure/data-tables, @azure/identity, applicationinsights
  host.json                       # extension bundle; CORS handled at app config, not host.json
  tsconfig.json  .funcignore
  src/
    game/
      index.ts                    # HTTP trigger /api/game: route op -> handler; error -> status; CORS headers
      cleanup.ts                  # TIMER trigger: delete games past expiresAt (+ orphaned code index rows)
      handlers.ts                 # create/join/start/act/state — pure-ish, take a GameStore
      store.ts                    # GameStore interface + entity (de)serialization
      tableStore.ts               # TableGameStore: single-table batch CAS + code index; DefaultAzureCredential
      memoryStore.ts              # in-memory GameStore for unit tests
      ids.ts                      # makeCode(), newToken()
      telemetry.ts                # App Insights init (no-op if connection string absent)
      engine.mjs                  # generated by build:edge:api (shared engine bundle)
    handlers.test.ts              # op contract tests (MemoryGameStore + real engine)
    redact.test.ts                # SECURITY property/fuzz test: redactState never leaks
    tableStore.test.ts            # batch CAS + code index against Azurite (integration; skips if absent)
infra/
  main.bicep                      # Storage + Function App (Consumption) + App Insights + SWA(Free) + RBAC + app settings
  main.parameters.json  abbreviations.json
azure.yaml                        # azd: 2 services (web -> SWA, api -> Function App)
staticwebapp.config.json          # SPA fallback for the static site
.devcontainer/devcontainer.json   # Node 20 + azd + swa + func + azurite preinstalled
.github/workflows/
  azure.yml                       # CD: deploy SWA (static) + Function App on push to main
  codeql.yml                      # security scanning
  ci.yml                          # MODIFY: tests only (web + api), no deploy
.github/dependabot.yml            # npm + actions update PRs
.github/ISSUE_TEMPLATE/*, PULL_REQUEST_TEMPLATE.md
SECURITY.md                       # threat model + reporting
docs/AZURE.md                     # provisioning + deploy-your-own
scripts/setup-azure.sh            # guarded `azd up` wrapper

src/game/azureClient.ts           # makeGameApi over fetch -> ${VITE_API_BASE}/game (replaces supabaseClient.ts)
src/game/networkTransport.ts      # MODIFY: drop Realtime; poll-only
src/game/multiplayerConfig.ts     # MODIFY: gate on VITE_API_BASE
src/game/useNetworkGame.ts        # MODIFY: import api from azureClient
# remove: src/game/supabaseClient.ts, supabase/, netlify.toml, @supabase/supabase-js
```

---

## Phase 0 — Scaffolding

### Task 0: Create the standalone `api/` Functions project
**Files:** Create `api/package.json`, `api/host.json`, `api/tsconfig.json`, `api/.funcignore`; modify root `package.json` (api scripts), `.gitignore`.
- [ ] **Step 1:** `api/package.json` deps: `@azure/functions ^4.5`, `@azure/data-tables ^13.3`, `@azure/identity ^4.4`, `applicationinsights ^3.2`; devDeps `typescript ^5.6`, `vitest ^3.2`, `azurite ^3.33`. Scripts: `build` (tsc), `test` (vitest), `start` (`func start`).
- [ ] **Step 2:** `api/host.json` (v2, extension bundle `[4.*, 5.0.0)`).
- [ ] **Step 3:** `api/tsconfig.json` (NodeNext, ES2022, outDir `dist`); `.funcignore` (`*.test.ts`, `src`, `node_modules`).
- [ ] **Step 4:** Root scripts: `api:install`, `api:build` (`npm run build:edge:api && npm --prefix api run build`), `api:test`, and `build:edge:api` = `esbuild src/game/edgeEntry.ts --bundle --format=esm --platform=neutral --outfile=api/src/game/engine.mjs`.
- [ ] **Step 5:** `npm run api:install`; placeholder `index.ts`; `npm --prefix api run build` compiles clean. Commit.

---

## Phase 1 — Storage layer (TDD)

### Task 1: `GameStore` interface + `MemoryGameStore`
**Files:** Create `api/src/game/store.ts`, `memoryStore.ts`; `api/src/handlers.test.ts` (store portion).
**Produces:**
```typescript
export interface GameRecord { gameId: string; code: string; status: string; version: number; seats: SeatInfo[]; expiresAt: string; }
export interface SecretRecord { state: GameState; seatTokens: Record<string, number>; }
export interface GameStore {
  createGame(rec: GameRecord, secret: SecretRecord): Promise<void>;   // writes code index first, then batch game+secret
  getByCode(code: string): Promise<string | null>;
  getGame(gameId: string): Promise<{ rec: GameRecord; etag: string } | null>;
  getSecret(gameId: string): Promise<SecretRecord | null>;
  update(gameId: string, etag: string, rec: GameRecord, secret: SecretRecord): Promise<boolean>; // batch CAS; false on ETag mismatch
  deleteExpired(now: string): Promise<number>;                        // for cleanup timer
}
```
- [ ] **Step 1:** Failing tests: create→getByCode; getGame returns rec+etag; update with current etag succeeds & changes etag; update with stale etag → `false`; `deleteExpired` removes only past-`expiresAt` games.
- [ ] **Step 2:** Run `npm --prefix api test` → FAIL.
- [ ] **Step 3:** Implement `store.ts` + `memoryStore.ts` (Maps; integer etag per game).
- [ ] **Step 4:** PASS. **Step 5:** Commit.

### Task 2: `TableGameStore` — single-table batch CAS + managed identity (Azurite integration)
**Files:** Create `api/src/game/tableStore.ts`, `api/src/tableStore.test.ts`.
**Produces:** `export function makeTableStore(): GameStore` that builds `TableClient`s via:
- Cloud: `new TableClient(\`https://\${account}.table.core.windows.net\`, "Games", new DefaultAzureCredential())` (account from `STORAGE_ACCOUNT` env).
- Local/test: if `AZURITE_CONNECTION`/`UseDevelopmentStorage=true` present, use `TableClient.fromConnectionString(...)`.
Idempotent `createTable` on init for `Games`, `GameCodes`.
**Rules:** `update` builds `submitTransaction([["update", gameRow, "Replace", { etag }], ["upsert", secretRow]])`; on `RestError` 412 → `false`. Guard `JSON.stringify(state).length < 60000` → throw `StateTooLargeError`. `createGame` upserts the `GameCodes` row, then `submitTransaction` for the two `Games` rows.
- [ ] **Step 1:** Tests mirror Task 1 against Azurite (`UseDevelopmentStorage=true`); `beforeAll` skips if Azurite unreachable.
- [ ] **Step 2:** `npx azurite --silent &`; run → FAIL. **Step 3:** Implement. **Step 4:** PASS; stop Azurite. **Step 5:** Commit.

---

## Phase 2 — Operations (TDD, contract-locked)

### Task 3: `ids.ts`
- [ ] Failing test: `makeCode()` ∈ `[A-Z2-9]{5}` minus `I,O,0,1`; `newToken()` = UUID v4. Implement (ported lines 76–85). PASS. Commit.

### Task 4: Port the five handlers (with `expiresAt` stamping)
**Files:** Create `api/src/game/handlers.ts`; extend `handlers.test.ts`.
**Produces:** `handleCreate/Join/Start/Act/State(store, body) => Promise<{status:number; body:unknown}>`. Behavior mirrors current `supabase/functions/game/index.ts` (create 158–286, join 289–348, start 351–393, act 396–453, state 456–472), with Postgres→`GameStore`, `version`-CAS→`store.update(...) === false ? 409 retry`, no-op via `===`. Each mutating op sets `rec.expiresAt = now + 14d`.
- [ ] **Step 1:** Failing contract tests vs `MemoryGameStore` + real engine: create shape; join seats 2nd human; host-only start deals & sets `playing`; act discard advances + bumps version, replay → `{ok:false,reason:"not-applied"}`; state redacts (viewer sees own hand only).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

---

## Phase 3 — HTTP trigger + CORS

### Task 5: Function entrypoint with CORS
**Files:** Replace `api/src/game/index.ts`.
**Produces:** `POST /api/game`, `authLevel:"anonymous"`, routing `op`→handler; `OPTIONS` preflight handled; CORS `Access-Control-Allow-Origin` from `ALLOWED_ORIGIN` env (the SWA URL; `*` acceptable for a public game but prefer the exact origin).
- [ ] **Step 1:** Implement `app.http("game", {... })` (per the v4 model) + a small `cors(res, origin)` helper applied to every response incl. preflight; instantiate `makeTableStore()` once at module scope.
- [ ] **Step 2:** `npm run api:build` clean.
- [ ] **Step 3:** Local smoke: Azurite + `func start`; `curl localhost:7071/api/game -d '{"op":"create",...}'` returns a game; an `OPTIONS` returns the CORS headers.
- [ ] **Step 4:** Commit.

---

## Phase 4 — Security property test

### Task 6: `redactState` never leaks (fuzz/property)
**Files:** Create `api/src/redact.test.ts`.
- [ ] **Step 1:** Write a fuzz test: generate N (≥2000) random in-progress `GameState`s (seeded RNG; vary players, hands, phase), call `redactState(state, viewerId)` for each seat and for `null` (spectator), assert: (a) the viewer's own hand is intact; (b) **every other seat's hand is entirely `HIDDEN_CARD` with the original count preserved**; (c) the deck is fully hidden; (d) at `dealEnd`/`gameOver` all hands reveal. Reuse the engine's existing card/state generators if present.
- [ ] **Step 2:** Run → PASS against the ported engine (this is a guard, not a fix). If it ever fails, that's a real leak — stop and fix the engine.
- [ ] **Step 3:** Commit (`test(api): redactState hidden-information property test`).

---

## Phase 5 — Cleanup timer

### Task 7: Timer-triggered reaper
**Files:** Create `api/src/game/cleanup.ts`; tests in `tableStore.test.ts`.
**Produces:** `app.timer("cleanup", { schedule: "0 0 3 * * *", handler })` (daily 03:00 UTC) calling `store.deleteExpired(new Date().toISOString())`; logs count to App Insights.
- [ ] **Step 1:** Test (`MemoryGameStore`): seed 3 games, 2 past `expiresAt`; `deleteExpired(now)` returns 2 and leaves 1. (Already covered in Task 1 store test; add the timer-handler wiring test asserting it calls the store.)
- [ ] **Step 2:** Implement `cleanup.ts`. **Step 3:** `npm run api:build` clean. **Step 4:** Commit.

---

## Phase 6 — Observability

### Task 8: Application Insights
**Files:** Create `api/src/game/telemetry.ts`; import once in `index.ts`/`cleanup.ts`.
**Produces:** `initTelemetry()` that, when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, starts the `applicationinsights` SDK (auto-collects requests, dependencies, exceptions, and Functions cold-start). No-op locally when unset.
- [ ] **Step 1:** Implement `telemetry.ts` (guarded `setup().start()`), call at module load. **Step 2:** Build clean; local run with the var unset logs nothing extra. **Step 3:** Commit.

---

## Phase 7 — Client transport swap

### Task 9: `azureClient.ts` (`GameApi` over fetch)
**Files:** Create `src/game/azureClient.ts`, `src/game/azureClient.test.ts`.
**Produces:** `makeGameApi(base = import.meta.env.VITE_API_BASE)` POSTing `{op,...}` to `${base}/game`; non-2xx reads JSON `error` and throws it; 409 `retry` → error message contains `retry`. `export const gameApi = makeGameApi();`
- [ ] **Step 1:** Failing test (stub `fetch`): create posts correct body/URL; 409 `{error:"retry"}` → rejects with `retry`; 400 `{error:"bad code"}` → rejects with `bad code`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task 10: Poll-only `NetworkTransport`
**Files:** Modify `src/game/networkTransport.ts`.
- [ ] **Step 1:** Update tests: `connect()` fetches once; poll tick → `refresh()`; `act()` → `api.act` then `refresh()`; `retry` rejection → silent resync. **Step 2:** FAIL. **Step 3:** Delete the Supabase `channel` block (~124–159); constructor takes `(api: GameApi, gameId, seatToken)`; `onStatus` reflects poll success/failure; `POLL_MS` ≈ 2500. Public surface + `NetworkSnapshot` unchanged. **Step 4:** PASS. **Step 5:** Commit.

### Task 11: Repoint config; remove Supabase
**Files:** Modify `multiplayerConfig.ts` (`multiplayerEnabled = Boolean(import.meta.env.VITE_API_BASE)`), `useNetworkGame.ts` + components to import from `azureClient`; delete `supabaseClient.ts`; remove `@supabase/supabase-js` from `package.json`.
- [ ] **Step 1:** `grep -rn "@supabase\|supabaseClient\|VITE_SUPABASE" src/` → repoint/remove each (`OnlineGame.tsx`, `OnlineRoot.tsx`, `JoinModal.tsx`, `SetupScreen.tsx`, `useNetworkGame.ts`).
- [ ] **Step 2:** `npm run typecheck` clean. **Step 3:** `npm test` green. **Step 4:** `npm run build` — no `@supabase` chunk. **Step 5:** Commit.

---

## Phase 8 — Infrastructure (Bicep + azd)

### Task 12: Bicep stack with managed identity
**Files:** Create `infra/main.bicep`, `infra/main.parameters.json`, `infra/abbreviations.json`, `azure.yaml`, `staticwebapp.config.json`.
**Provisions:** Storage account (Standard_LRS) · Application Insights · a **Function App (Consumption, Linux, Node 20)** with a **system-assigned identity** · a **role assignment** granting that identity **Storage Table Data Contributor** on the storage account · a **Static Web App (Free)**. Function App settings: `STORAGE_ACCOUNT`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `ALLOWED_ORIGIN` (the SWA URL). No data connection strings.
- [ ] **Step 1:** Author `main.bicep` (modules or single file) with the resources + the RBAC `Microsoft.Authorization/roleAssignments` (role id `0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3` = Storage Table Data Contributor) scoped to the storage account, principalId = Function App identity.
- [ ] **Step 2:** `staticwebapp.config.json` SPA fallback (`navigationFallback` → `/index.html`, exclude `/assets/*`).
- [ ] **Step 3:** `azure.yaml` with two services: `web` (host `staticwebapp`, dist `dist`) and `api` (host `function`, project `api`).
- [ ] **Step 4:** `az bicep build --file infra/main.bicep` compiles (run if Azure CLI present; else manual gate). Commit.

> Do **not** run `azd up` in automated execution — it creates billable resources and needs the maintainer's login. It's the documented manual step (Task 18).

---

## Phase 9 — CI/CD

### Task 13: Deploy workflow (static + functions) and CI split
**Files:** Create `.github/workflows/azure.yml`; modify `.github/workflows/ci.yml`.
- [ ] **Step 1:** `azure.yml` on push to `main`: checkout; setup-node 20; `npm ci`; `npm run build` (web) with `VITE_API_BASE` from repo **variable**; `npm run api:install && npm run api:build`; deploy static via `Azure/static-web-apps-deploy@v1` (token `AZURE_STATIC_WEB_APPS_API_TOKEN`, `skip_app_build: true`, `app_location:"dist"`, `api_location:""`); deploy the function via `Azure/functions-action@v1` (`app-name`, `package: api`, auth via `AZURE_CREDENTIALS` OIDC or publish profile). *(Alternatively a single `azd deploy` step — note both; prefer the two purpose-built actions for clarity.)*
- [ ] **Step 2:** `ci.yml` → tests only: web `typecheck`/`test`/edge-sync/`build`, plus `api:install`/`api:build`/`api:test`. Remove all Netlify/Supabase steps + secrets.
- [ ] **Step 3:** YAML validates. Commit.

---

## Phase 10 — Local dev

### Task 14: One-command online dev
**Files:** Modify root `package.json`; `.gitignore` (`.azurite/`).
- [ ] **Step 1:** Scripts: `dev:api` = `concurrently "azurite --silent --location .azurite" "npm --prefix api start"`; `dev:online` = `swa start http://localhost:5173 --run "npm run dev" --api-location http://localhost:7071`. Add `concurrently` + `@azure/static-web-apps-cli` as root devDeps (or document `npx`). Local `VITE_API_BASE=/api` (swa proxies to the function).
- [ ] **Step 2:** Manual verify: two tabs create+join converge against local Azurite. Commit.

---

## Phase 11 — OSS excellence hygiene

### Task 15: Devcontainer, scanning, templates, SECURITY.md
**Files:** Create `.devcontainer/devcontainer.json`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `SECURITY.md`.
- [ ] **Step 1:** `.devcontainer` on the Node 20 image with features/post-create installing `azd`, `swa`, Azure Functions Core Tools, and running `npm ci && npm run api:install` — a contributor gets a working online-dev env in one click.
- [ ] **Step 2:** `codeql.yml` (javascript-typescript, on push/PR + weekly schedule). `dependabot.yml` (npm at root + `api/`, and github-actions).
- [ ] **Step 3:** `SECURITY.md`: reporting contact + **threat model** — anonymous endpoints, join-code entropy (`24^5 ≈ 8M`), mitigations (per-IP create cap, 14-day game TTL, unguessable codes, server-side redaction), and the documented non-goals.
- [ ] **Step 4:** Issue/PR templates. Commit.

### Task 16: Per-IP create cap (lightweight abuse guard)
**Files:** Modify `api/src/game/handlers.ts` (create), `api/src/game/tableStore.ts`.
- [ ] **Step 1:** Test: >N creates from one IP within a window → 429. **Step 2:** FAIL. **Step 3:** Implement a tiny counter (a `Throttle` table row keyed by IP+hour, incremented; cap e.g. 30/hour) read from the request IP header (`x-forwarded-for`). **Step 4:** PASS. **Step 5:** Commit.

---

## Phase 12 — Getting-started + cleanup

### Task 17: Docs, button, remove Supabase/Netlify
**Files:** Create `docs/AZURE.md`, `scripts/setup-azure.sh`; modify `README.md`, `docs/DEPLOY.md`; delete `supabase/`, `netlify.toml`, dead scripts, `docs/SUPABASE.md`, obsolete `.claude/skills/deploy-supabase` + `deploy-netlify`.
- [ ] **Step 1:** `docs/AZURE.md` — the cloner's path: prerequisites (`az`, `azd`); `az login` → `azd up` (provisions Storage + Function App + App Insights + SWA, wires managed-identity RBAC, deploys, prints URLs); set the SWA's `VITE_API_BASE` repo variable to the Function App URL; optional custom domain + Azure DNS (~$0.50/mo) note; **cost/free-tier reality** (≈$0 idle; first request after long idle cold-starts in a few seconds and **auto-resumes with no manual step**); **set a Budget alert**.
- [ ] **Step 2:** `scripts/setup-azure.sh` — guarded wrapper (checks `az`/`azd` + login, then `azd up`). README "Deploy your own (Azure)" + **"Deploy to Azure" button** (Bicep) + updated Scripts table (`api:*`, `dev:online`; remove Netlify/Supabase forms).
- [ ] **Step 3:** Delete Supabase/Netlify artifacts + obsolete skills; fold `build:edge` into `build:edge:api`.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build && npm run api:build && npm run api:test` all green; `grep -rn "supabase\|netlify" src/ docs/ package.json` returns only intended history. Commit.

---

## Phase 13 — Final verification

### Task 18: End-to-end on a throwaway Azure instance
- [ ] **Step 1:** Maintainer `azd up` to a test subscription; SWA serves the site; cross-origin `create/join/start/act/state` work across two browsers; verify the Function reaches Table Storage via **managed identity** (no connection strings present).
- [ ] **Step 2:** Idle/cold-start check: hit, wait, hit again — auto-wakes, no manual step; record cold-start time.
- [ ] **Step 3:** Confirm the cleanup timer ran (App Insights) and an expired test game was removed.
- [ ] **Step 4:** Push a trivial change → `azure.yml` redeploys static + function; smoke-check live. `azd down`. Document what worked.

---

## Self-review

- **Spec coverage:** standalone Function App topology (Phases 0–9) ✓; managed identity / no secrets (Tasks 2, 12) ✓; atomic batch CAS (data model, Tasks 1/2/4) ✓; game TTL + timer cleanup (Tasks 4/7) ✓; redactState leak property test (Task 6) ✓; App Insights (Task 8) ✓; OSS hygiene — devcontainer/CodeQL/Dependabot/SECURITY/templates (Task 15) + per-IP cap (Task 16) ✓; non-goals documented ✓; SWA Free static + CORS (Tasks 5/12/13) ✓; online optional via `VITE_API_BASE` (Task 11) ✓; one-command provisioning + button (Task 17) ✓.
- **Contract consistency:** `GameApi` shape unchanged (Reference); `NetworkTransport` public surface unchanged (Task 10) → `useNetworkGame`/components are import-only edits; `GameStore` signatures consistent across memory/table impls and handlers.
- **Open risks to validate in execution:** (a) Function App Consumption cold-start magnitude after long idle — measured in Task 18 (acceptable per requirements). (b) Managed-identity RBAC propagation can lag minutes post-provision — `azd up` may need a retry; note in docs. (c) CORS exactness — prefer `ALLOWED_ORIGIN` = SWA URL over `*`. (d) Table Storage 60 KB state guard (Task 2). (e) `applicationinsights` SDK must init before other requires to auto-instrument — import `telemetry.ts` first (Task 8).
```
