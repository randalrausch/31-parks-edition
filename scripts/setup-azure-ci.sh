#!/usr/bin/env bash
#
# Wire the azd-provisioned Azure values into this repo's GitHub Actions Variables
# and Secrets, so `.github/workflows/azure.yml` can auto-deploy on push to main.
# Run this AFTER `./scripts/setup-azure.sh` (or `azd up`) has succeeded. See
# docs/AZURE.md → "Automated deploys". Idempotent — safe to re-run.
#
# Sets:  Variables DEPLOY_AZURE, VITE_API_BASE, AZURE_FUNCTIONAPP_NAME
#        Secrets   AZURE_STATIC_WEB_APPS_API_TOKEN, AZURE_FUNCTIONAPP_PUBLISH_PROFILE
#
# Usage:  ./scripts/setup-azure-ci.sh

set -euo pipefail
cd "$(dirname "$0")/.."

err() { printf '\033[31mError: %s\033[0m\n' "$1" >&2; }
ok()  { printf '\033[32mOK: %s\033[0m\n' "$1"; }
step(){ printf '\n\033[1m==> %s\033[0m\n' "$1"; }

for tool in az azd gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "'$tool' not found."
    echo "  Need: az, azd, gh (GitHub CLI), jq. See docs/AZURE.md."
    exit 1
  fi
done
az account show >/dev/null 2>&1 || { err "Not logged in to Azure — run 'az login'."; exit 1; }
gh auth status >/dev/null 2>&1 || { err "GitHub CLI not authenticated — run 'gh auth login'."; exit 1; }
ok "az, azd, gh, jq present and authenticated"

step "Reading azd outputs"
vals="$(azd env get-values --output json)"
get() { printf '%s' "$vals" | jq -er ".$1" 2>/dev/null; }

VITE_API_BASE="$(get VITE_API_BASE)" \
  || { err "No azd outputs found. Run ./scripts/setup-azure.sh (azd up) first."; exit 1; }
FUNCTION_APP_NAME="$(get FUNCTION_APP_NAME)"
STATIC_WEB_APP_NAME="$(get STATIC_WEB_APP_NAME)"
RESOURCE_GROUP="$(get RESOURCE_GROUP)"

echo "  VITE_API_BASE       = $VITE_API_BASE"
echo "  FUNCTION_APP_NAME   = $FUNCTION_APP_NAME   (-> GitHub var AZURE_FUNCTIONAPP_NAME)"
echo "  STATIC_WEB_APP_NAME = $STATIC_WEB_APP_NAME"
echo "  RESOURCE_GROUP      = $RESOURCE_GROUP"

step "Fetching deploy credentials (az)"
SWA_TOKEN="$(az staticwebapp secrets list --name "$STATIC_WEB_APP_NAME" \
  --query "properties.apiKey" -o tsv)"
[ -n "$SWA_TOKEN" ] || { err "Empty Static Web App deployment token."; exit 1; }
PUBLISH_PROFILE="$(az functionapp deployment list-publishing-profiles \
  --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP" --xml)"
printf '%s' "$PUBLISH_PROFILE" | grep -q "publishProfile" \
  || { err "Function App publish profile didn't look like XML."; exit 1; }
ok "Got SWA token + Function publish profile"

step "Setting GitHub Variables + Secrets (gh)"
gh variable set DEPLOY_AZURE           --body "true"
gh variable set VITE_API_BASE          --body "$VITE_API_BASE"
gh variable set AZURE_FUNCTIONAPP_NAME --body "$FUNCTION_APP_NAME"
printf '%s' "$SWA_TOKEN"       | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN
printf '%s' "$PUBLISH_PROFILE" | gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE
ok "5 items set"

step "Done"
gh variable list
echo "  (secrets are write-only; listed by name only)"
echo ""
echo "  Push to main — or Actions → Deploy (Azure) → Run workflow — to deploy."
echo "  DEPLOY_AZURE=true also disables the Netlify/Supabase deploys in ci.yml."
