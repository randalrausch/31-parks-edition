# CI runner image — bakes the slow-to-install toolchain the pipeline otherwise
# reinstalls on a cold VM for every job of every run: the Playwright browser plus
# all of its system dependencies, on top of Node 20. Built + pushed to GHCR by
# .github/workflows/ci-image.yml (weekly, and whenever this file changes), so CI
# jobs pull a ready image instead of spending ~26s on `playwright install
# --with-deps chrome` each time.
#
# Pin the base to the repo's @playwright/test version (package.json) so the baked
# browser matches the test runner exactly — bump both together. The Microsoft
# Playwright base already ships Node 20 and every browser system library.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# The E2E specs launch Google Chrome (channel "chrome" in playwright.config.ts),
# not bundled Chromium — the base image carries the browsers' shared libraries but
# not the branded Chrome package, so add just that. Clean apt lists to keep the
# layer small. Pin the CLI to the same version so this can't drift from the base.
RUN npx -y playwright@1.61.1 install --with-deps chrome \
    && rm -rf /var/lib/apt/lists/*

# npm dependencies are deliberately NOT baked in: they change with the lockfile
# and are already fast via actions/setup-node's npm cache + `npm ci`. Azurite (the
# api CAS suite's emulator) installs as an api devDependency during that `npm ci`,
# so it needs no image layer either. This image is only the stable, expensive
# part — the browser and OS libraries.
