---
description: Play a live deployed site end-to-end (solo + two-browser online) with Playwright.
argument-hint: <url> (e.g. https://play31.fun)
allowed-tools: Bash(npm run test:e2e:deploy), Bash(ls:*)
---

Run the deployment smoke test against the live site: **$1**

This drives a real browser against the URL and actually plays the game — boots +
version check, a solo turn, and a two-browser online round (create → join →
start → act, verifying per-seat hand redaction) against the deployed backend.

Steps:

1. Run: `E2E_BASE_URL=$1 npm run test:e2e:deploy`
2. If the browser can't be found (no branded Chrome), point Playwright at a
   Chromium binary and retry, e.g. prefix with
   `PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
   (adjust the path to whatever Chromium is installed).
3. Report which of the three tests passed. The online test skips gracefully if
   multiplayer isn't enabled on that build.

Note: reaching the live site requires network egress to that host. In a
locked-down sandbox the connection may be blocked by policy (a 403 at the proxy);
if so, report that the host is blocked rather than routing around it — this test
is meant to run from CI (it runs automatically post-deploy in `azure.yml`) or a
developer machine.
