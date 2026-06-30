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
| Authority API | **Azure Functions (Consumption, Node 20)** | Scales to zero; auto-wakes on request — no pause |
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

- **Node 20+**
- An **Azure subscription** (the Free tier is enough)
- **Azure CLI** (`az`) and **Azure Developer CLI** (`azd`)
  - macOS: `brew install azure-cli azd`
  - Windows: `winget install Microsoft.AzureCLI Microsoft.Azd`
  - Linux: see the official install docs for each
- For local development also: **Azure Functions Core Tools** (`func`) and the
  **Static Web Apps CLI** (`swa`). `npm i -g azure-functions-core-tools@4 @azure/static-web-apps-cli`

## Deploy from scratch

You need an Azure subscription and the tools from **Prerequisites** above.
Everything that identifies you — subscription ID, region, budget email, custom
domain — is stored in the **gitignored** `.azure/<env>/.env`, never in a tracked
file, so this is safe to run on a public clone.

1. **Log in** (both open a browser):
   ```bash
   az login
   azd auth login
   ```

2. **Create an environment and set your config.** These values land in
   `.azure/<env>/.env` (gitignored):
   ```bash
   azd env new prod
   azd env set AZURE_LOCATION centralus            # region
   azd env set BUDGET_ALERT_EMAIL you@example.com  # optional: enables a budget alert
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
| `BUDGET_ALERT_EMAIL` | Email for budget alerts. **The budget is only created if this is set.** |
| `CUSTOM_DOMAIN` | A **subdomain** to bind (e.g. `play.example.com`). Apex/root domains (e.g. `play31.fun`) are set up in the Portal instead — see "Custom domain" below. |

```bash
azd env set BUDGET_ALERT_EMAIL you@example.com
```

**2. `infra/main.parameters.json` — non-sensitive policy knobs (checked in).**
Edit the literals and re-run `azd provision`:

| Parameter | Default | What it does |
|-----------|---------|--------------|
| `monthlyBudgetAmount` | `10` | Monthly budget in your billing currency. `0` disables it. |
| `maxFunctionInstances` | `5` | Hard cap on Function scale-out (bounds peak cost). |
| `logAnalyticsDailyQuotaGb` | `1` | Daily telemetry ingestion cap in GB (`-1` = unlimited). |
| `maxGamesPerDay` | `500` | Global hard ceiling on games created per day. |
| `maxGamesPerIpPerHour` | `20` | Per-IP create cap per hour. |

`environmentName`, `location`, `resourceGroupName`, `customDomain`, and
`budgetAlertEmail` are all `${...}` references filled from the azd environment
above — leave those as-is.

### Custom domain

Static Web Apps issues a **free managed TLS certificate** once DNS points at it.
The records differ for a **subdomain** (e.g. `play.example.com`) vs. an
**apex/root** domain (e.g. `play31.fun`).

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

#### Apex / root domain (e.g. `play31.fun`) — do it in the Portal

An apex can't be a plain CNAME, so it needs **two records** plus a TXT-token
ownership handshake that Azure generates on the fly. Use the **Portal** and leave
`CUSTOM_DOMAIN` **empty** (the param is CNAME-delegation, subdomain-only; azd's
incremental deploys won't disturb a Portal-added domain).

1. **Azure Portal** → your Static Web App → **Custom domains** → **+ Add** →
   **Custom domain on other DNS** → enter `play31.fun`. Azure shows a **TXT**
   record (a name + a validation code). Leave the page open.
2. **At your DNS provider** add **two** records:

   | Type | Name | Content / Target | Proxy / notes |
   |------|------|------------------|---------------|
   | **TXT** | *(exactly what Azure shows — for an apex it's `@`)* | *(the code Azure shows)* | ownership validation |
   | **CNAME** | `@` (root) | `<swa-host>.azurestaticapps.net` | routing — **must be DNS-only, not proxied** |

3. Back in Azure, click **Validate / Add**. Azure verifies the TXT, then issues
   the TLS cert (a few minutes). `https://play31.fun` then serves directly.

> **Cloudflare specifics.** Cloudflare automatically **flattens** a root (`@`)
> CNAME into A records — exactly what an apex needs, so the table above works
> as-is. Keep the CNAME on **“DNS only” (grey cloud), not “Proxied” (orange)**:
> grey cloud means Cloudflare only answers DNS while **Azure serves the site and
> terminates TLS**, so nothing extra sits in front of your domain. Orange cloud
> would put Cloudflare's CDN/TLS in front (double-CDN, and you'd then have to
> manage Cloudflare's SSL/TLS mode). Because it's DNS-only, Cloudflare's SSL/TLS
> settings don't apply here at all. (TXT records are always DNS-only.)

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

`.github/workflows/azure.yml` is **opt-in and additive** — it does nothing unless
you enable it, so it never interferes with the Netlify/Supabase pipeline.

Enable it under **Settings → Secrets and variables → Actions**:

| Kind | Name | Where to get it |
|------|------|-----------------|
| Variable | `DEPLOY_AZURE` | set to `true` |
| Variable | `VITE_API_BASE` | `https://<your-func>.azurewebsites.net/api` (from `azd` output) |
| Variable | `AZURE_FUNCTIONAPP_NAME` | the Function App name (`azd env get-values`) |
| Secret | `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA → **Manage deployment token** |
| Secret | `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Function App → **Get publish profile** |

On push to `main` it builds web + api, deploys the Function App first, then the
prebuilt static site.

## Cost protection (so an attack or bug can't run up a bill)

At family scale this is effectively **$0**: Static Web Apps Free (no overage
billing — it just caps), Functions Consumption (1M free executions/month), Table
Storage (pennies). But a public, anonymous endpoint needs guards so abuse, a bug,
or a traffic spike can't drive cost. Several layers, all configurable in
`infra/main.parameters.json`:

| Layer | Control | Bounds |
|-------|---------|--------|
| **Scale-out cap** | `maxFunctionInstances` (default 5) | Even under a flood the Function can't fan out to hundreds of instances — caps the *rate* of spend. |
| **Global daily ceiling** | `maxGamesPerDay` (default 500) | A hard cap on total games created/day, enforced by a durable Table-Storage counter shared across instances. No distributed spam can exceed it. |
| **Per-IP cap** | `maxGamesPerIpPerHour` (default 20) | Stops a single source flooding `create`. |
| **Per-instance limiter** | built-in | Cheap first line (no storage round-trip) on every request. |
| **Telemetry cap** | `logAnalyticsDailyQuotaGb` (default 1) | App Insights/Log Analytics ingestion can't run up cost. |
| **Storage growth** | 14-day game TTL + daily reaper | Abandoned games are deleted; storage stays bounded. |
| **Budget alert** | `monthlyBudgetAmount` + `budgetAlertEmail` | Emails you at 80% actual / 100% forecast of your monthly cap. |

> **About the budget:** Azure budgets are an **alarm**, not a hard stop — Azure has
> no true "switch off spending" toggle. The *enforcement* comes from the caps above
> (they bound how much work the system will ever do); the budget gives you early
> warning with plenty of headroom to react. To set it, run
> `azd env set BUDGET_ALERT_EMAIL you@example.com` and set `monthlyBudgetAmount`
> in `infra/main.parameters.json`, then `azd provision`.
> For a true kill-switch, attach an Action Group → Automation runbook that stops
> the Function App at 100% (advanced; see Azure Cost Management docs).

After a long idle period the **first request cold-starts in a few seconds and
auto-resumes** — there is no paused state to wake by hand. That is the whole
reason this option exists.

## Security notes

- **Game data uses managed identity** (the Function App's system identity has the
  *Storage Table Data Contributor* role) — there is **no data connection string**.
- The Functions *runtime* store (`AzureWebJobsStorage`) uses a standard storage
  connection string; it holds no game data.
- CORS is locked to the Static Web App origin. Never put a storage key or the
  `service_role`-style secret into a `VITE_` variable (those ship to the browser).
