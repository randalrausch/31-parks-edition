# Azure backend (optional)

This is **one of three** ways to run online multiplayer. You can ignore it
entirely and use **Supabase + Netlify** (see [SUPABASE.md](SUPABASE.md) and
[DEPLOY.md](DEPLOY.md)) — all three are supported, and the app auto-selects a
provider from environment variables.

The Azure option is a good fit if you want the demo to **just work after long
gaps with no manual un-pausing**: everything scales to zero, costs ~nothing idle,
and the first request after weeks auto-cold-starts in a few seconds.

## What it provisions

| Piece | Service | Why |
|-------|---------|-----|
| Static site | **Azure Static Web Apps (Free)** | Global CDN, free TLS + custom domains |
| Authority API | **Azure Functions (Consumption, Node 22)** | Scales to zero; auto-wakes on request — no pause |
| Game state | **Azure Table Storage** | Always available; pennies; accessed via **managed identity (no secret)** |
| Telemetry | **Application Insights** | Traces, errors, cold-start timing |

The SPA calls the Function cross-origin at `${VITE_API_BASE}/game`. Game state
rows (public + secret) share one partition and commit atomically (ETag batch).
Abandoned games are reaped by a daily timer (14-day expiry).

The resource group (`rg-31-parks-edition-<env>` by default) and every resource
are tagged so the stack is easy to spot and filter in the portal:
`project=31-parks-edition`, `app=31: National Parks Edition`, `managed-by=azd`,
`repo=<github url>`, plus azd's own `azd-env-name`.

## Prerequisites

- **Node 22+**
- An **Azure subscription** (the Free tier is enough)
- **Azure CLI** (`az`) and **Azure Developer CLI** (`azd`)
  - macOS: `brew install azure-cli azd`
  - Windows: `winget install Microsoft.AzureCLI Microsoft.Azd`
  - Linux: see the official install docs for each
- For local development also: **Azure Functions Core Tools** (`func`) and the
  **Static Web Apps CLI** (`swa`). `npm i -g azure-functions-core-tools@4 @azure/static-web-apps-cli`

## Deploy from scratch

You need an Azure subscription and the tools from **Prerequisites** above.
Everything that identifies you — subscription ID, region, custom domain — is
stored in the **gitignored** `.azure/<env>/.env`, never in a tracked file, so
this is safe to run on a public clone.

1. **Log in** (both open a browser):
   ```bash
   az login
   azd auth login
   ```

2. **Create an environment and set your config.** These values land in
   `.azure/<env>/.env` (gitignored):
   ```bash
   azd env new prod
   azd env set AZURE_LOCATION centralus   # region
   # The subscription is chosen interactively on the first `azd up`. To pin it:
   # azd env set AZURE_SUBSCRIPTION_ID <sub-guid>
   ```
   Leave `CUSTOM_DOMAIN` unset for now — bind a domain *after* the first deploy
   (see [Custom domain](#custom-domain)).

3. **Provision + deploy — one command:**
   ```bash
   azd up
   ```
   `azd up` provisions everything in `infra/`, deploys the Function App and the
   Static Web App, and — because `main.bicep` outputs `VITE_API_BASE` — rebuilds
   the SPA pointed at your new Function URL. When it finishes it prints the site
   URL.

> If the site loads but online play is disabled, the web build didn't pick up the
> API URL. Run `azd deploy web` once more (the output is set by then), or
> `azd env get-values | grep VITE_API_BASE` to confirm it's populated.

Tear it all down with **`azd down`**.

## Configuration

Two places, split by sensitivity.

**1. azd environment — anything identifying (gitignored).** Stored in
`.azure/<env>/.env`; set with `azd env set`, then re-run `azd up` / `azd provision`
to apply. `infra/main.parameters.json` reads these via `${VAR}` substitution, so
the real values never touch a tracked file:

| Variable | What it does |
|----------|--------------|
| `AZURE_SUBSCRIPTION_ID` | Which subscription to bill/deploy to (or pick at the `azd up` prompt). |
| `AZURE_LOCATION` | Region, e.g. `centralus`. |
| `AZURE_RESOURCE_GROUP` | Custom resource-group name (optional; default `rg-31-parks-edition-<env>`). |
| `CUSTOM_DOMAIN` | A **subdomain** to bind (e.g. `play.example.com`). Apex/root domains (e.g. `example.com`) are set up in the Portal instead — see "Custom domain" below. |
| `ALLOWED_ORIGINS` | Extra CORS origins the API accepts (comma-separated), e.g. an apex domain bound via the Portal. The SWA default host and any `CUSTOM_DOMAIN` are included automatically. |

**2. `infra/main.parameters.json` — non-sensitive policy knobs (checked in).**
Edit the literals and re-run `azd provision`:

| Parameter | Default | What it does |
|-----------|---------|--------------|
| `maxFunctionInstances` | `5` | Hard cap on Function scale-out (bounds peak cost). |
| `logAnalyticsDailyQuotaGb` | `1` | Daily telemetry ingestion cap in GB (`-1` = unlimited). |
| `maxGamesPerDay` | `2000` | Global hard ceiling on games created per day. |
| `maxGamesPerIpPerHour` | `20` | Per-IP create cap per hour. |

`environmentName`, `location`, `resourceGroupName`, and `customDomain` are
`${...}` references filled from the azd environment above — leave those as-is.

### Custom domain

Static Web Apps issues a **free managed TLS certificate** once DNS points at it.
The records differ for a **subdomain** (e.g. `play.example.com`) vs. an
**apex/root** domain (e.g. `example.com`).

First, deploy once and grab your SWA default hostname — you'll point DNS at it:

```bash
azd env get-values | grep STATIC_WEB_APP_URL
# e.g. https://nice-river-0abc.azurestaticapps.net → use the HOST part only
```

#### Subdomain — one CNAME, managed by azd

1. At your DNS provider add a **CNAME**: `play` → `<swa-host>.azurestaticapps.net`.
2. Bind it and re-provision:
   ```bash
   azd env set CUSTOM_DOMAIN play.example.com
   azd provision
   ```

#### Apex / root domain (e.g. `example.com`) — do it in the Portal

An apex can't be a plain CNAME, so it needs **two records** plus a TXT-token
ownership handshake that Azure generates on the fly. Use the **Portal** and leave
`CUSTOM_DOMAIN` **empty** (the param is CNAME-delegation, subdomain-only; azd's
incremental deploys won't disturb a Portal-added domain).

1. **Azure Portal** → your Static Web App → **Custom domains** → **+ Add** →
   **Custom domain on other DNS** → enter `example.com`. Azure shows a **TXT**
   record (a name + a validation code). Leave the page open.
2. **At your DNS provider** add **two** records:

   | Type | Name | Content / Target | Proxy / notes |
   |------|------|------------------|---------------|
   | **TXT** | *(exactly what Azure shows — for an apex it's `@`)* | *(the code Azure shows)* | ownership validation |
   | **CNAME** | `@` (root) | `<swa-host>.azurestaticapps.net` | routing — **DNS-only recommended** (see note) |

3. Back in Azure, click **Validate / Add**. Azure verifies the TXT, then issues
   the TLS cert (a few minutes). `https://example.com` then serves directly.
4. **Allow the new origin in the API (CORS).** The Function only accepts requests
   from origins it's told about, so a Portal-bound apex must be added explicitly,
   then re-provisioned:
   ```bash
   azd env set ALLOWED_ORIGINS https://example.com
   azd provision
   ```
   Skip this and the site loads but online play fails with **"backend
   Unreachable" / "Couldn't reach the game server"** — a CORS rejection. (A
   *subdomain* bound via `CUSTOM_DOMAIN` is added to CORS automatically; only
   Portal-managed apex domains need this.)

> **What gives you the bare apex URL:** adding **`example.com`** (not
> `www.example.com` or any prefix) in step 1 is the only thing that determines the
> URL has no word in front. The Cloudflare proxy choice below does **not** change
> the URL — `https://example.com` either way.
>
> **Cloudflare proxy (grey vs orange).** Cloudflare automatically **flattens** a
> root (`@`) CNAME into A records — exactly what an apex needs, so the table works
> as-is. For that CNAME, **“DNS only” (grey cloud) is recommended** — not to
> change the URL, but for reliability: Azure issues and serves its own managed TLS
> cert, and that auto-issuance often gets stuck while the record is **“Proxied”
> (orange)** because Cloudflare intercepts Azure's validation. You *can* run it
> proxied to put Cloudflare's CDN/DDoS in front — then set Cloudflare **SSL/TLS to
> “Full”** and expect some cert-issuance fiddling. If unsure, use grey cloud.
> (TXT records are always DNS-only.)

## Run it locally (online, against the emulator)

1. Create `api/local.settings.json` (gitignored):
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "AzureWebJobsStorage": "UseDevelopmentStorage=true",
       "FUNCTIONS_WORKER_RUNTIME": "node",
       "TABLES_CONNECTION": "UseDevelopmentStorage=true",
       "ALLOWED_ORIGIN": "*"
     }
   }
   ```
2. In one terminal start the emulator + functions:
   ```bash
   npm run api:install
   npx azurite --silent --location .azurite &
   npm run api:start          # func start on :7071
   ```
3. In another, run the SPA proxied to the API:
   ```bash
   npm run dev:online:azure   # swa start -> Vite + /api proxy to :7071
   ```
   (Or just `VITE_API_BASE=http://localhost:7071/api npm run dev`.)

Create a game in one tab and join with the code from another — both converge
within the poll interval.

## Automated deploys (GitHub Actions)

The Azure deploy is **opt-in** — the `deploy-azure` job in
`.github/workflows/ci.yml` does nothing unless you enable it with the `DEPLOY_AZURE`
Variable below. It runs only after the tests pass on `main`.

**The easy way — after `azd up`, run:**

```bash
./scripts/setup-azure-ci.sh
```

It reads the azd outputs and sets every GitHub item (with the right names) via
the `gh` CLI — using OIDC when the deployer identity exists (below), the legacy
stored credentials otherwise. Requires `az` logged in and `gh` authenticated.
Idempotent.

### Deploy from CI without stored credentials (OIDC — recommended)

By default the deploy job authenticates with two **long-lived stored secrets**
(a Function App publish profile and an SWA deployment token). The better mode
is OIDC: `infra/` can provision a **federated deployer identity** that GitHub
Actions logs in as with a per-run token minted for *exactly this repo's `main`
branch* — nothing long-lived is stored in GitHub, nothing to rotate or leak.
One-time setup:

```bash
azd env set GITHUB_REPO <owner>/<repo>   # e.g. randalrausch/31-parks-edition
azd provision                            # creates the identity + roles (see resources.bicep)
./scripts/setup-azure-ci.sh              # detects OIDC and sets the GitHub items
```

That stores three **identity** secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID` — useless to anyone who can't mint this repo's OIDC
token) plus the `AZURE_SWA_NAME` variable (the workflow fetches a fresh SWA
deployment token each run and masks it). The identity holds only two
resource-scoped roles: Website Contributor on the Function App and Contributor
on the Static Web App. `ci.yml` prefers OIDC whenever the three secrets exist
and falls back to the stored credentials otherwise — so migrate whenever, and
**after the first green OIDC deploy** delete the legacy pair:

```bash
gh secret delete AZURE_FUNCTIONAPP_PUBLISH_PROFILE
gh secret delete AZURE_STATIC_WEB_APPS_API_TOKEN
```

### Setting the GitHub items by hand

Under **Settings → Secrets and variables → Actions** — note the azd output
names don't all match the GitHub names:

| Kind | GitHub name | Value / source (`azd env get-values`) |
|------|-------------|----------------------------------------|
| Variable | `DEPLOY_AZURE` | type `true` |
| Variable | `VITE_API_BASE` | azd output **`VITE_API_BASE`** (copy verbatim; it's `https://<func-app>.azurewebsites.net/api`) |
| Variable | `AZURE_FUNCTIONAPP_NAME` | azd output **`FUNCTION_APP_NAME`** ⚠️ (name differs) |
| Variable | `AZURE_SITE_URL` *(optional)* | your live SWA URL — enables the post-deploy smoke |
| **OIDC mode** | | |
| Variable | `AZURE_SWA_NAME` | azd output **`STATIC_WEB_APP_NAME`** |
| Secret | `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` | azd outputs of the same names (present once provisioned with `GITHUB_REPO` set) |
| **Legacy mode** (only when not using OIDC) | | |
| Secret | `AZURE_STATIC_WEB_APPS_API_TOKEN` | `az staticwebapp secrets list --name <STATIC_WEB_APP_NAME> --query properties.apiKey -o tsv` (or Portal → SWA → **Manage deployment token**) |
| Secret | `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | `az functionapp deployment list-publishing-profiles --name <FUNCTION_APP_NAME> -g <RESOURCE_GROUP> --xml` (or Portal → Function App → **Get publish profile**) |

On push to `main` it builds web + api, deploys the Function App first, then the
prebuilt static site.

> **Infra changes don't auto-deploy — by design.** CI holds data-plane deploy
> rights only, so merging a change under `infra/**` updates nothing in Azure
> until you run `azd provision`. The `infra-drift.yml` workflow opens a
> reminder issue on any such merge (when `DEPLOY_AZURE` is on); close it after
> provisioning.

> **`DEPLOY_AZURE` is independent of the Supabase/Netlify flags.** Setting it to
> `true` activates this Azure workflow; it no longer touches `ci.yml`'s
> `DEPLOY_SUPABASE` / `DEPLOY_NETLIFY` deploy steps — so you can run Azure only,
> the Supabase/Netlify stack only, both stacks side by side, or none. The
> `ci.yml` tests/quality gate keep running on every push and PR regardless. To
> stop Azure deploys, set `DEPLOY_AZURE` to `false` (or delete the Variable).

## Cost protection (so an attack or bug can't run up a bill)

At family scale this is effectively **$0**: Static Web Apps Free (no overage
billing — it just caps), Functions Consumption (1M free executions/month), Table
Storage (pennies). But a public, anonymous endpoint needs guards so abuse, a bug,
or a traffic spike can't drive cost. Several layers, all configurable in
`infra/main.parameters.json`:

| Layer | Control | Bounds |
|-------|---------|--------|
| **Scale-out cap** | `maxFunctionInstances` (default 5) | Even under a flood the Function can't fan out to hundreds of instances — caps the *rate* of spend. |
| **Global daily ceiling** | `maxGamesPerDay` (default 2000) | A hard cap on total games created/day, enforced by a durable Table-Storage counter shared across instances. No distributed spam can exceed it. |
| **Per-IP cap** | `maxGamesPerIpPerHour` (default 20) | Stops a single source flooding `create`. |
| **Per-instance limiter** | built-in | Cheap first line (no storage round-trip) on every request. |
| **Telemetry cap** | `logAnalyticsDailyQuotaGb` (default 1) | App Insights/Log Analytics ingestion can't run up cost. |
| **Storage growth** | 14-day game TTL + daily reaper | Abandoned games are deleted; storage stays bounded. |
| **Budget alert** | Portal (Cost Management → Budgets) | Optional email alarm at, e.g., 80% actual / 100% forecast of a monthly cap. |

> **About the budget:** it's an **alarm**, not a hard stop — Azure has no true
> "switch off spending" toggle. The *enforcement* comes from the caps above (they
> bound how much work the system will ever do); a budget just gives early warning.
> It is **not** created by this template: Azure locks a budget's start date once
> its period is active, which makes any re-`azd provision` fail. Set one yourself
> in the **Portal → Cost Management → Budgets** (or once via CLI:
> `az consumption budget create-with-rg --budget-name parks --resource-group <rg> --amount 10 --time-grain Monthly --category Cost`).
> For a true kill-switch, attach an Action Group → Automation runbook that stops
> the Function App at 100% (advanced; see Azure Cost Management docs).

After a long idle period the **first request cold-starts in a few seconds and
auto-resumes** — there is no paused state to wake by hand. That is the whole
reason this option exists.

## Alerting (recommended for a public deployment)

Application Insights already collects everything you need; add a couple of alert
rules (Portal → your App Insights → **Alerts → Create alert rule**, or via
`az monitor`) so a problem pages you instead of being discovered by a player:

- **Server error rate.** The router emits one structured log line per request as
  `{op, status, ms}` (and always logs failures with the `gameId`). Alert on a
  sustained rate of `status >= 500`, e.g. a Logs (KQL) alert over `traces`:
  `traces | where message has '"status":5' | summarize count() by bin(timestamp, 5m)`.
- **Health-probe failures.** The `health` op round-trips storage and returns 503
  when the datastore is unreachable. Alert on any `503` from `op":"health"` — that
  distinguishes "backend up but DB down" from a total outage.
- **Reaper heartbeat.** The daily cleanup timer logs
  `cleanup: removed N expired game(s), M stale rate row(s)`. Alert if that line is
  **absent** for > 25 hours (the timer stopped firing, so games/rate rows would
  grow unbounded).

None of these are provisioned by the Bicep template (alert thresholds are
deployment-specific); wiring one 5xx alert and one health alert takes a couple of
minutes in the Portal and is the difference between a trustworthy deploy and a
silent one.

## Security notes

- **Game data uses managed identity** (the Function App's system identity has the
  *Storage Table Data Contributor* role) — there is **no data connection string**.
- The Functions *runtime* store (`AzureWebJobsStorage`) uses a standard storage
  connection string; it holds no game data.
- CORS is locked to the Static Web App origin. Never put a storage key or the
  `service_role`-style secret into a `VITE_` variable (those ship to the browser).
