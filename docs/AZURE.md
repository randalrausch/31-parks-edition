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

## Prerequisites

- **Node 20+**
- An **Azure subscription** (the Free tier is enough)
- **Azure CLI** (`az`) and **Azure Developer CLI** (`azd`)
  - macOS: `brew install azure-cli azd`
  - Windows: `winget install Microsoft.AzureCLI Microsoft.Azd`
  - Linux: see the official install docs for each
- For local development also: **Azure Functions Core Tools** (`func`) and the
  **Static Web Apps CLI** (`swa`). `npm i -g azure-functions-core-tools@4 @azure/static-web-apps-cli`

## Deploy your own (one command)

```bash
az login
azd auth login
azd up      # prompts for an environment name + region (e.g. centralus)
```

`azd up` provisions everything in `infra/`, deploys the Function App and the
Static Web App, and — because `main.bicep` outputs `VITE_API_BASE` — rebuilds the
SPA pointed at your new Function URL. When it finishes it prints the site URL.

> If the site loads but online play is disabled, the web build didn't pick up the
> API URL. Run `azd deploy web` once more (the output is set by then), or
> `azd env get-values | grep VITE_API_BASE` to confirm it's populated.

Tear it all down with **`azd down`**.

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

## Cost & free-tier reality

At family scale this is effectively **$0**: Static Web Apps Free, Functions
Consumption (1M free executions/month), Table Storage (pennies). The only thing
that can surprise you is a runaway — so **set an Azure Budget alert**
(Cost Management → Budgets) after `azd up`.

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
