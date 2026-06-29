#!/usr/bin/env bash
#
# One-command setup for the OPTIONAL Azure backend. Wraps `azd up` with a couple
# of guardrails. See docs/AZURE.md for the full walkthrough. Netlify + Supabase
# remain supported and are unaffected by this.
#
# Usage:  ./scripts/setup-azure.sh

set -euo pipefail
cd "$(dirname "$0")/.."

err() { printf '\033[31mError: %s\033[0m\n' "$1" >&2; }
ok()  { printf '\033[32mOK: %s\033[0m\n' "$1"; }
step(){ printf '\n\033[1m==> %s\033[0m\n' "$1"; }

for tool in az azd; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "'$tool' not found."
    echo "  Install: brew install azure-cli azd   (or see docs/AZURE.md)"
    exit 1
  fi
done
ok "Azure CLI + azd present"

if ! az account show >/dev/null 2>&1; then
  step "Logging in to Azure"
  az login
fi
azd auth login >/dev/null 2>&1 || azd auth login
ok "Authenticated"

step "Provisioning + deploying (azd up)"
echo "  You'll be prompted for an environment name and a region (e.g. centralus)."
azd up

step "Done"
echo "  Site + API URLs are shown above (and in: azd env get-values)."
echo "  Online play is enabled automatically (VITE_API_BASE was set at build)."
echo "  Tip: set an Azure Budget alert (Cost Management → Budgets)."
