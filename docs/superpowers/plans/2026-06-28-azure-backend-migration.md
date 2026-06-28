# Azure Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase backend (Postgres + Deno edge function + Realtime) with an Azure backend (Static Web Apps managed Azure Functions API + Azure Table Storage + client polling), and make it one-command provisionable for open-source users.

**Architecture:** The game's online play sits entirely behind one TypeScript interface, `GameApi` (5 ops: `create`, `join`, `start`, `act`, `state`). We port the authority logic into a single HTTP-triggered Azure Function served at `/api/game` by Azure Static Web Apps, back it with Azure Table Storage (two tables + a code index), replace optimistic-concurrency `version` CAS with Table Storage ETags, and drop Supabase Realtime in favor of the polling the client already does. The pure game engine (`engine.mjs`) is reused unchanged. Infrastructure is declared in Bicep and provisioned with `azd up` (plus a "Deploy to Azure" button) so a cloner can stand up their own instance in one command.

**Tech Stack:** Azure Static Web Apps (Free), Azure Functions (Node 20 / TypeScript, managed API), Azure Table Storage (`@azure/data-tables`), Azurite (local emulator), Static Web Apps CLI (`swa`) for local dev, Bicep + Azure Developer CLI (`azd`) for provisioning, GitHub Actions (`Azure/static-web-apps-deploy`) for CD, Vite/React/TypeScript frontend (unchanged), Vitest.

## Global Constraints

- **Preserve the `GameApi` contract verbatim** — every op's request/response JSON shape stays identical so the React UI, `useNetworkGame`, `OnlineSession`, and components need no behavioral change. Exact shapes are in "Reference: GameApi contract" below.
- **Server stays authoritative.** Hidden cards never leave the server un-redacted; `redactState(state, seatId)` runs before every state response. Secrets (full state + seat tokens) live only in a non-public table the client can never read directly.
- **No new runtime dependency in the game core.** The engine remains pure TS bundled by `npm run build:edge`; the Azure Function imports that bundle.
- **Node 20** for both the web build and the Functions API (matches current CI).
- **Free-tier only by default.** SWA Free + Table Storage + Functions Consumption (managed). No resource that bills while idle beyond trivial storage. Document any cost.
- **Online must remain optional.** A static-only host (no `/api`) still builds and serves solo + pass-and-play; the online entry points hide when the API base is absent.
- **Frequent commits**, one per task. Keep `engine.mjs` committed and CI-verified in sync with source (existing guard).

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

Wire envelope (POST JSON to `/api/game`), one body per op — identical to the current Supabase function:
- `create`: `{ op:"create", config:{ creatorName, humans, ai:[...], options:{threeOfAKind,grace,knockPenalty,sound} } }` → `{ gameId, code, seatIndex:0, seatToken }`
- `join`: `{ op:"join", code, name }` → `{ gameId, seatIndex, seatToken }`
- `start`: `{ op:"start", gameId, seatToken }` → `{ ok:true }`
- `act`: `{ op:"act", gameId, seatToken, action:{ type, cardId? } }` → `{ ok:true }` | `{ ok:false, reason:"not-applied" }` | HTTP 409 (message contains "retry")
- `state`: `{ op:"state", gameId, seatToken? }` → `{ status, version, seats, seatIndex, state }`

Engine functions consumed (from `engine.mjs`, unchanged): `createGameState`, `applyAction`, `applyPlayerAction`, `advanceAuthority`, `redactState`.

---

## Data model (Azure Table Storage)

Three tables in one Storage account (the account also serves as the Functions runtime store):

1. **`Games`** — public lobby state (mirrors `public.games`).
   - PartitionKey = `gameId`, RowKey = `"game"`.
   - Props: `code` (string), `status` (string), `version` (int32), `seats` (string = JSON), `createdAt` (datetime), `updatedAt` (datetime).
   - ETag drives optimistic concurrency (replaces the manual `version` CAS; `version` is retained purely as the client-visible change counter).

2. **`GameSecrets`** — authoritative state + tokens (mirrors `public.game_secrets`, never client-readable).
   - PartitionKey = `gameId`, RowKey = `"secret"`.
   - Props: `state` (string = JSON `GameState`), `seatTokens` (string = JSON `{ [token]: seatIndex }`).
   - Table Storage string property cap is 64 KB; a 31 game state is far smaller. (Guard noted in Task 2.)

3. **`GameCodes`** — code→gameId index (Table Storage has no secondary index; we maintain one).
   - PartitionKey = `code`, RowKey = `code`. Props: `gameId` (string).

`Games` and `GameSecrets` are updated together under the same logical operation; both bump in lockstep. Concurrency is enforced on the `Games` ETag — losers get a 409 "retry".

---

## File Structure

```bash
api/                              # Azure Functions managed API (new)
  package.json                    # api deps: @azure/functions, @azure/data-tables
  host.json                       # Functions host config
  tsconfig.json
  src/
    game/
      index.ts                    # HTTP trigger: routes op -> handler, maps errors to status
      handlers.ts                 # create/join/start/act/state — pure-ish, take a GameStore
      store.ts                    # GameStore interface + entity (de)serialization helpers
      tableStore.ts               # TableGameStore: @azure/data-tables impl w/ ETag CAS + code index
      memoryStore.ts              # MemoryGameStore: in-memory impl for unit tests
      ids.ts                      # makeCode(), token generation (ported)
      engine.mjs                  # built by `npm run build:edge` (shared, generated)
    handlers.test.ts              # op contract tests against MemoryGameStore
    tableStore.test.ts            # ETag/CAS + code-index tests against Azurite (integration)
infra/                            # IaC (new)
  main.bicep                      # SWA + Storage account + tables; outputs
  main.parameters.json
  abbreviations.json
azure.yaml                        # azd service map (frontend + api)
staticwebapp.config.json          # SWA routing/SPA fallback (replaces netlify.toml role)
.github/workflows/azure.yml       # CD via Azure/static-web-apps-deploy (replaces deploy in ci.yml)
docs/AZURE.md                     # provisioning + "deploy your own" guide
scripts/setup-azure.sh            # thin wrapper around `azd up` with prompts (optional convenience)

src/game/azureClient.ts           # makeGameApi over fetch -> /api/game (replaces supabaseClient.ts)
src/game/networkTransport.ts      # MODIFY: remove Realtime channel; keep polling
src/game/multiplayerConfig.ts     # MODIFY: gate on VITE_API_BASE (default "/api")
src/game/useNetworkGame.ts        # MODIFY: import api from azureClient
# remove: src/game/supabaseClient.ts, supabase/, @supabase/supabase-js dep
```

---

## Phase 0 — Scaffolding

### Task 0: Create the `api/` Functions project

**Files:**
- Create: `api/package.json`, `api/host.json`, `api/tsconfig.json`, `api/.funcignore`
- Modify: root `package.json` (add api-aware scripts), `.gitignore` (api build artifacts)

**Interfaces:**
- Produces: an installable `api/` project that `func start` and the SWA build can compile.

- [ ] **Step 1:** Create `api/package.json`:

```json
{
  "name": "31-parks-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/game/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "func start"
  },
  "dependencies": {
    "@azure/functions": "^4.5.0",
    "@azure/data-tables": "^13.3.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^3.2.6",
    "azurite": "^3.33.0"
  }
}
```

- [ ] **Step 2:** Create `api/host.json`:

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  },
  "logging": { "logLevel": { "default": "Information" } }
}
```

- [ ] **Step 3:** Create `api/tsconfig.json` (ES modules, Node 20, outDir `dist`). Create `api/.funcignore` excluding `*.test.ts`, `node_modules`, `src`.

- [ ] **Step 4:** Add root scripts to `package.json`:

```json
"api:install": "npm --prefix api install",
"api:build": "npm run build:edge:api && npm --prefix api run build",
"api:test": "npm --prefix api test",
"build:edge:api": "esbuild src/game/edgeEntry.ts --bundle --format=esm --platform=neutral --outfile=api/src/game/engine.mjs"
```

(`build:edge` keeps emitting `supabase/...` only until Phase 9 removes it; `build:edge:api` emits the same bundle into the api tree. Task 9 collapses these.)

- [ ] **Step 5:** Run `npm run api:install` and `npm --prefix api run build` — expect a clean compile of an empty `src` (add a placeholder `api/src/game/index.ts` exporting nothing, replaced in Task 5). Commit.

---

## Phase 1 — Storage layer (TDD)

### Task 1: `GameStore` interface + `MemoryGameStore`

**Files:**
- Create: `api/src/game/store.ts`, `api/src/game/memoryStore.ts`, `api/src/handlers.test.ts` (store portion)

**Interfaces:**
- Produces:
```typescript
export interface GameRecord { gameId: string; code: string; status: string; version: number; seats: SeatInfo[]; }
export interface SecretRecord { state: GameState; seatTokens: Record<string, number>; }
export interface GameStore {
  createGame(rec: GameRecord, secret: SecretRecord): Promise<void>;       // also writes code index
  getByCode(code: string): Promise<string | null>;                        // -> gameId
  getGame(gameId: string): Promise<{ rec: GameRecord; etag: string } | null>;
  getSecret(gameId: string): Promise<SecretRecord | null>;
  // Compare-and-set on the Games row by etag; writes secret in the same logical update.
  // Resolves false if the etag no longer matches (caller maps to 409 retry).
  update(gameId: string, etag: string, rec: GameRecord, secret: SecretRecord): Promise<boolean>;
}
```

- [ ] **Step 1:** Write failing test `api/src/handlers.test.ts` exercising `MemoryGameStore`: create → getByCode resolves the gameId; getGame returns rec+etag; update with the current etag succeeds and changes etag; update with a stale etag resolves `false`.
- [ ] **Step 2:** Run `npm --prefix api test` — expect FAIL (module not found).
- [ ] **Step 3:** Implement `store.ts` (types only) and `memoryStore.ts` (a `Map<gameId,…>` with a monotonic integer etag per game, plus a `Map<code,gameId>`).
- [ ] **Step 4:** Run tests — expect PASS.
- [ ] **Step 5:** Commit (`feat(api): GameStore interface + in-memory store`).

### Task 2: `TableGameStore` (Azure Table Storage, ETag CAS) — integration test against Azurite

**Files:**
- Create: `api/src/game/tableStore.ts`, `api/src/tableStore.test.ts`

**Interfaces:**
- Consumes: `GameStore` from Task 1, `@azure/data-tables` (`TableClient`, `odata`).
- Produces: `export function makeTableStore(conn: string): GameStore` creating/using tables `Games`, `GameSecrets`, `GameCodes` (calls `createTable` idempotently on init).

**Implementation notes (must follow):**
- Entities: `Games` `{ partitionKey:gameId, rowKey:"game", code, status, version, seats:JSON, createdAt, updatedAt }`; `GameSecrets` `{ partitionKey:gameId, rowKey:"secret", state:JSON, seatTokens:JSON }`; `GameCodes` `{ partitionKey:code, rowKey:code, gameId }`.
- `getGame` returns the entity's `etag`. `update` calls `gamesClient.updateEntity(entity, "Replace", { etag })`; on a `RestError` with `statusCode === 412`, resolve `false`. Always write the secret entity (Replace) before/after the games update within the same call; the games ETag is the gate.
- Guard: before writing `state`, assert `JSON.stringify(state).length < 60000`; throw a typed `StateTooLargeError` (not expected for this game, but fail loud).

- [ ] **Step 1:** Write `api/src/tableStore.test.ts` mirroring Task 1's assertions but against a real store, using `AZURITE` connection string `UseDevelopmentStorage=true`. Add a `beforeAll` that skips the suite if Azurite isn't reachable (so unit CI stays green without the emulator).
- [ ] **Step 2:** Start Azurite (`npx azurite --silent &`) and run `npm --prefix api test` — expect FAIL (not implemented).
- [ ] **Step 3:** Implement `tableStore.ts`.
- [ ] **Step 4:** Run against Azurite — expect PASS. Stop Azurite.
- [ ] **Step 5:** Commit (`feat(api): Table Storage GameStore with ETag CAS + code index`).

---

## Phase 2 — Operation handlers (TDD, contract-locked)

### Task 3: Port `ids.ts` (code + token generation)

**Files:** Create `api/src/game/ids.ts`; tests in `handlers.test.ts`.
- [ ] **Step 1:** Failing test: `makeCode()` returns 5 chars from alphabet `[A-Z2-9]` excluding `I,O,0,1`; 1000 calls are unique-ish and never contain excluded chars. `newToken()` returns a v4 UUID.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `makeCode()` (ported from current function lines 76–85) and `newToken = () => crypto.randomUUID()`.
- [ ] **Step 4:** Run — PASS. Commit.

### Task 4: Port the five op handlers

**Files:**
- Create: `api/src/game/handlers.ts`
- Test: extend `api/src/handlers.test.ts`

**Interfaces:**
- Consumes: `GameStore`, `ids.ts`, and the engine (`createGameState`, `applyAction`, `applyPlayerAction`, `advanceAuthority`, `redactState` from `engine.mjs`).
- Produces:
```typescript
export type OpResult = { status: number; body: unknown };
export async function handleCreate(store: GameStore, body: CreateBody): Promise<OpResult>;
export async function handleJoin(store: GameStore, body: JoinBody): Promise<OpResult>;
export async function handleStart(store: GameStore, body: StartBody): Promise<OpResult>;
export async function handleAct(store: GameStore, body: ActBody): Promise<OpResult>;
export async function handleState(store: GameStore, body: StateBody): Promise<OpResult>;
```

Each handler reproduces the exact behavior catalogued in the Explore map (validation, seat assignment, CAS-on-conflict→409 "retry", no-op detection via `===` reference equality for `act`, status transitions lobby→playing→over). Ported logic mirrors current `supabase/functions/game/index.ts` lines: create 158–286, join 289–348, start 351–393, act 396–453, state 456–472 — with Postgres calls swapped for `GameStore` calls and the `version`-CAS swapped for `store.update(...)` returning `false` → `{ status:409, body:{ error:"retry" } }`.

- [ ] **Step 1:** Write failing contract tests against `MemoryGameStore` (use the real engine via `import "./game/engine.mjs"`):
  - `create` returns `{ gameId, code, seatIndex:0, seatToken }`; a subsequent `state` with that token shows `status:"lobby"` and the creator seated at idx 0.
  - `join` with the returned `code` seats a second human and returns a distinct `seatToken`/`seatIndex`.
  - `start` by the host transitions `status:"playing"` and deals (state has non-empty hands); non-host `start` → 403.
  - `act` discard by the seated player advances state and bumps `version`; the same `act` replayed (no-op) returns `{ ok:false, reason:"not-applied" }`.
  - `state` redacts: a viewer sees only their own hand; opponents are HIDDEN_CARD with preserved counts.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `handlers.ts`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit (`feat(api): port create/join/start/act/state handlers`).

---

## Phase 3 — HTTP trigger

### Task 5: Wire the Azure Function entrypoint

**Files:**
- Modify/replace: `api/src/game/index.ts`

**Interfaces:**
- Consumes: `@azure/functions` v4 programming model (`app.http`), `handlers.ts`, `makeTableStore`.
- Produces: an HTTP route `game` (POST, anonymous) at `/api/game`.

- [ ] **Step 1:** Implement:

```typescript
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { makeTableStore } from "./tableStore.js";
import * as h from "./handlers.js";

const store = makeTableStore(process.env.TABLES_CONNECTION ?? process.env.AzureWebJobsStorage!);
const ops = { create: h.handleCreate, join: h.handleJoin, start: h.handleStart, act: h.handleAct, state: h.handleState } as const;

app.http("game", {
  methods: ["POST"], authLevel: "anonymous", route: "game",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
    const fn = (ops as any)[body?.op];
    if (!fn) return json(400, { error: "unknown op" });
    try {
      const { status, body: out } = await fn(store, body);
      return json(status, out);
    } catch (e: any) {
      return json(e?.status ?? 500, { error: e?.message ?? "server error" });
    }
  },
});

function json(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body, headers: { "content-type": "application/json" } };
}
```

- [ ] **Step 2:** `npm run api:build` — expect clean compile.
- [ ] **Step 3:** Local smoke: start Azurite + `npm --prefix api start`; `curl -s localhost:7071/api/game -d '{"op":"create","config":{...}}'` returns a `gameId`/`code`/`seatToken`. (Use a minimal valid config.)
- [ ] **Step 4:** Commit (`feat(api): HTTP trigger routes ops to handlers`).

---

## Phase 4 — Client transport swap

### Task 6: `azureClient.ts` — `GameApi` over fetch

**Files:**
- Create: `src/game/azureClient.ts`
- Test: `src/game/azureClient.test.ts`

**Interfaces:**
- Produces: `export function makeGameApi(base = apiBase): GameApi` and `export const gameApi = makeGameApi();` where `apiBase` comes from `VITE_API_BASE` (default `"/api"`). Each method POSTs `{ op, ... }` to `${base}/game` and surfaces server `error` messages by reading the JSON body on non-2xx (preserving the current user-facing error behavior). A 409 whose body error includes `"retry"` is thrown as an error whose message contains `retry` (so `NetworkTransport.act` keeps resyncing instead of toasting).

- [ ] **Step 1:** Write failing test with a stubbed `fetch`: `create` posts `{op:"create",config}` to `/api/game` and returns the parsed body; a 409 `{error:"retry"}` rejects with a message containing `retry`; a 400 `{error:"bad code"}` rejects with `bad code`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `azureClient.ts`.
- [ ] **Step 4:** Run — PASS. Commit.

### Task 7: Remove Realtime from `NetworkTransport`; keep polling

**Files:**
- Modify: `src/game/networkTransport.ts` (delete the Supabase `channel` subscription at lines ~124–159; keep the 4 s poll loop; the `onStatus`/link-health indicator now reflects poll success/failure instead of Realtime socket state)
- Modify: constructor — replace `(client: SupabaseClient, gameId, seatToken)` with `(api: GameApi, gameId, seatToken)`; internal calls become `this.api.act(...)`, `this.api.state(...)`.

**Interfaces:**
- Consumes: `GameApi` (Task 6). Produces: unchanged `NetworkTransport` public surface (`connect`, `refresh`, `act`, `nextDeal`, `subscribe`, `onStatus`, `getState`, `seatId`, `destroy`) and `NetworkSnapshot` type — so `useNetworkGame` is untouched except its import.

- [ ] **Step 1:** Update the existing transport tests (or add one) asserting: `connect()` fetches once; a poll tick triggers `refresh()`; `act()` calls `api.act` then `refresh()`; a `retry` rejection from `act` triggers a silent resync, not an error emit.
- [ ] **Step 2:** Run — FAIL (constructor/type mismatch).
- [ ] **Step 3:** Refactor `networkTransport.ts`; shorten `POLL_MS` to e.g. 2500 (no Realtime now, so polling is the only signal — still negligible cost: ~24 calls/min/active player only while a game is open).
- [ ] **Step 4:** Run — PASS. Commit (`refactor: poll-only transport over Azure GameApi`).

### Task 8: Repoint config + remove Supabase from the client

**Files:**
- Modify: `src/game/multiplayerConfig.ts` — `export const multiplayerEnabled = (import.meta.env.VITE_API_BASE ?? "/api") !== "";` (online on by default when deployed to SWA; a static-only host sets `VITE_API_BASE=""` to hide online).
- Modify: `src/game/useNetworkGame.ts:8` and any component importing `gameApi`/`supabase` → import from `azureClient`.
- Delete: `src/game/supabaseClient.ts`.
- Modify: root `package.json` — remove `@supabase/supabase-js` from dependencies.

- [ ] **Step 1:** `grep -rn "@supabase\|supabaseClient\|from \"./supabaseClient\"\|VITE_SUPABASE" src/` and repoint/remove each hit (components listed in the map: `OnlineGame.tsx`, `OnlineRoot.tsx`, `JoinModal.tsx`, `SetupScreen.tsx`, `useNetworkGame.ts`).
- [ ] **Step 2:** `npm run typecheck` — expect clean (no Supabase types remain).
- [ ] **Step 3:** `npm test` — expect existing suite green.
- [ ] **Step 4:** `npm run build` — expect a successful production build with no `@supabase` chunk.
- [ ] **Step 5:** Commit (`refactor: drop Supabase client; online uses /api`).

---

## Phase 5 — Infrastructure as code

### Task 9: Bicep + azd + SWA routing

**Files:**
- Create: `infra/main.bicep`, `infra/main.parameters.json`, `infra/abbreviations.json`
- Create: `azure.yaml`
- Create: `staticwebapp.config.json`
- Delete (later, Task 12): `netlify.toml`, `public/_redirects` Netlify specifics (SWA uses `staticwebapp.config.json`)

**Interfaces:**
- Produces: `azd up` provisions a resource group, a Storage account (with tables auto-created by the API at runtime), and a Static Web App (Free) whose managed API is the `api/` project; outputs the SWA hostname and sets `TABLES_CONNECTION` as a SWA app setting.

- [ ] **Step 1:** `infra/main.bicep` (sketch — concrete in implementation): a `Microsoft.Storage/storageAccounts` (Standard_LRS) and a `Microsoft.Web/staticSites` (SKU `Free`), with the storage connection string written into the static site's app settings (`Microsoft.Web/staticSites/config` `appsettings`, key `TABLES_CONNECTION`). Parameterize `location`, `name` prefix.
- [ ] **Step 2:** `staticwebapp.config.json`:

```json
{
  "navigationFallback": { "rewrite": "/index.html", "exclude": ["/assets/*", "/api/*"] },
  "routes": [{ "route": "/api/*", "methods": ["POST"] }]
}
```

- [ ] **Step 3:** `azure.yaml` declaring one service: app location `/`, output `dist`, api location `api`. (Schema header `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/azure-dev/main/schemas/v1.0/azure.yaml.json`.)
- [ ] **Step 4:** Validate: `az bicep build --file infra/main.bicep` compiles with no errors (run if Azure CLI present; otherwise note as a manual gate). Commit (`feat(infra): Bicep + azd + SWA config`).

> **Do not run `azd up` as part of automated execution** — it creates billable cloud resources and needs the maintainer's Azure login. It is a documented manual step (Task 11).

---

## Phase 6 — CI/CD

### Task 10: Replace the deploy pipeline with the SWA Action

**Files:**
- Create: `.github/workflows/azure.yml`
- Modify: `.github/workflows/ci.yml` — strip the Netlify + Supabase deploy steps (keep typecheck/test/edge-sync/build as the PR + push quality gate). `build:edge` now also feeds the api (Task 0 `build:edge:api`).

**Interfaces:**
- Produces: on push to `main`, GitHub Actions builds the site **and** the api and deploys both to SWA via `Azure/static-web-apps-deploy@v1` using secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. No Netlify/Supabase secrets remain.

- [ ] **Step 1:** Author `azure.yml`:

```yaml
name: Deploy (Azure SWA)
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read }
concurrency: { group: swa-${{ github.ref }}, cancel-in-progress: false }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build:edge:api          # bundle engine into api/
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: upload
          app_location: "/"
          api_location: "api"
          output_location: "dist"
```

- [ ] **Step 2:** Edit `ci.yml` to remove the deploy steps and the now-unused secrets/env; keep tests + `api:test`. Add `npm run api:install && npm run api:build && npm run api:test` to the quality gate so the API is type-checked and unit-tested on every PR.
- [ ] **Step 3:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/azure.yml')); yaml.safe_load(open('.github/workflows/ci.yml'))"` → valid. Commit (`ci: deploy to Azure Static Web Apps; drop Netlify/Supabase`).

---

## Phase 7 — Local dev

### Task 11: One-command local online dev (swa + Azurite)

**Files:**
- Modify: root `package.json` scripts; `docs/AZURE.md` (local section)

- [ ] **Step 1:** Add scripts:

```json
"dev": "vite",
"dev:api": "concurrently \"azurite --silent --location .azurite\" \"npm --prefix api start\"",
"dev:online": "swa start http://localhost:5173 --run \"npm run dev\" --api-location http://localhost:7071"
```

(Add `concurrently` + `@azure/static-web-apps-cli` as root devDependencies, or document `npx swa`. `.azurite/` added to `.gitignore`.)

- [ ] **Step 2:** Manual verify: `npm run dev:online`, open the served URL, create a game in one tab and join from another — both converge within the poll interval against local Azurite. Document the steps. Commit.

---

## Phase 8 — Getting-started UX (the open-source provisioning experience)

### Task 12: `docs/AZURE.md`, README + DEPLOY rewrite, "Deploy to Azure" button, cleanup

**Files:**
- Create: `docs/AZURE.md`, `scripts/setup-azure.sh`
- Modify: `README.md`, `docs/DEPLOY.md` (Azure-first; demote/remove other hosts as needed), `docs/SUPABASE.md` (delete or mark legacy)
- Delete: `supabase/` directory, `netlify.toml`, root `package.json` Netlify/Supabase scripts, `.claude/skills/deploy-supabase` + `deploy-netlify` (replace with a single `deploy-azure` note), `build:edge` Supabase output path (fold into `build:edge:api`).

**`docs/AZURE.md` must cover (the cloner's path):**
1. **One-command provision:** `npm i -g @azure/static-web-apps-cli azure-dev` (or `winget/brew` for `azd`), `az login`, then `azd up` → creates Storage + SWA, wires `TABLES_CONNECTION`, deploys, prints the URL. 2 commands after login.
2. **Or click-to-deploy:** a **"Deploy to Azure" button** in the README targeting `infra/main.bicep` (Azure Portal "Deploy a custom template" with the repo's Bicep), followed by connecting the GitHub repo for CD (SWA prompts for it and injects `AZURE_STATIC_WEB_APPS_API_TOKEN`).
3. **CI secret:** if not using the SWA-managed token injection, add `AZURE_STATIC_WEB_APPS_API_TOKEN` (SWA → Manage deployment token).
4. **Custom domain (optional):** SWA → Custom domains; optional Azure DNS zone (~$0.50/mo) note.
5. **Cost & free-tier reality:** SWA Free + Functions Consumption + Table Storage are ~$0 idle; first request after long inactivity cold-starts in a few seconds and **auto-resumes with no manual step** (the migration's whole point). Recommend setting an **Azure Budget alert**.

- [ ] **Step 1:** Write `docs/AZURE.md` and `scripts/setup-azure.sh` (a guarded wrapper: checks `az`/`azd` present and logged in, then runs `azd up`).
- [ ] **Step 2:** Add the README "Deploy your own (Azure)" section + button; replace Supabase/Netlify references; update the Scripts table (`api:*`, `dev:online`, remove `deploy:web`/`deploy:backend` Supabase/Netlify forms or repoint them to `azd deploy`).
- [ ] **Step 3:** Delete `supabase/`, `netlify.toml`, dead scripts, and obsolete skills.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build && npm run api:build && npm run api:test` — all green. `grep -rn "supabase\|netlify" src/ docs/ package.json` returns only intentional/historical mentions. Commit (`docs: Azure provisioning guide; remove Supabase/Netlify`).

---

## Phase 9 — Final verification

### Task 13: End-to-end on a real (throwaway) Azure instance

- [ ] **Step 1:** Maintainer runs `azd up` against a test subscription; confirm SWA URL serves the site and `/api/game` create/join/act/state work across two browsers.
- [ ] **Step 2:** Idle test (best-effort): hit the API, wait, hit again — confirm cold-start works with no manual intervention (document observed cold-start time).
- [ ] **Step 3:** Push a trivial change to `main`; confirm the SWA Action redeploys; smoke-check the live bundle.
- [ ] **Step 4:** Tear down (`azd down`) the throwaway instance. Note the documented steps that worked.

---

## Self-review notes

- **Spec coverage:** frontend host (SWA, Phase 5/6) ✓; auto-wake backend (Functions Consumption, inherent) ✓; never-pause datastore (Table Storage, Phase 1) ✓; polling not realtime (Task 7) ✓; easy provisioning for OSS (azd + Bicep + button + docs, Phase 8) ✓; keep online optional (Task 8 gate) ✓; Azure DNS optional (documented, Task 12) ✓.
- **Contract consistency:** `GameApi` shape identical pre/post (Reference section); `NetworkTransport` public surface unchanged (Task 7) so `useNetworkGame`/components are import-only edits.
- **Open risks to validate during execution:** (a) SWA *managed* API limits (timeout/runtime) — our single short HTTP op fits, but Task 5 smoke-tests it; if a limit bites, fall back to a standalone Function App + SWA "bring your own functions" (needs SWA Standard) or CORS — noted as the escape hatch. (b) `concurrently`/`swa`/`azurite` are dev-only deps; keep them out of the production bundle. (c) Table Storage 64 KB string cap — guarded in Task 2.
