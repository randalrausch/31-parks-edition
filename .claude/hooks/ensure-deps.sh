#!/usr/bin/env bash
# SessionStart hook — make the repo immediately usable in a fresh session.
#
# Claude Code on the web clones the container clean, so node_modules is absent
# and `npm run lint/test/build` would fail on the first try. This installs deps
# when they're missing (fast no-op once present) so a session can run the gates
# right away. It never fails the session — a dependency hiccup shouldn't block
# the chat — and prints one status line that becomes session context.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if [ ! -d node_modules ]; then
  echo "Installing web dependencies…"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1
  else
    npm install --no-audit --no-fund >/dev/null 2>&1
  fi
fi

if [ -d api ] && [ ! -d api/node_modules ]; then
  echo "Installing Azure Functions dependencies (api/)…"
  npm --prefix api install --no-audit --no-fund >/dev/null 2>&1 || true
fi

echo "Repo ready. Gates: npm run typecheck · lint · test · build (see CLAUDE.md)."
exit 0
