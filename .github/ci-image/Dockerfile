# CI runner image — bakes the slow-to-install toolchain the pipeline otherwise
# reinstalls on a cold VM for every job of every run: Google Chrome plus all of its
# system dependencies, on top of Node 20. Built + pushed to GHCR by
# .github/workflows/ci-image.yml (weekly, and whenever this file changes), so the
# e2e job pulls a ready image instead of running `playwright install --with-deps
# chrome` on a cold VM each time.
#
# Slim on purpose: a plain Node base + only the browser the E2E specs actually use
# (Google Chrome, via `channel: "chrome"`). The official Playwright base image also
# bundles Chromium, Firefox, and WebKit (~2GB) that this project never launches, so
# it made the e2e job's cold image pull slower than the install it replaced. This
# carries just Chrome, roughly halving the image and the pull.
FROM node:20-bookworm-slim

# `playwright install --with-deps chrome` downloads Google Chrome and apt-installs
# its shared-library dependencies. ca-certificates is required for the HTTPS
# download on the slim base; the rest of the OS libs come from --with-deps. Pin the
# CLI to the repo's @playwright/test version (package.json) so the baked browser
# matches the test runner — the gate's check-ci-image guard fails the build if these
# drift. Clean apt lists to keep the layer small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && npx -y playwright@1.61.1 install --with-deps chrome \
    && rm -rf /var/lib/apt/lists/*

# npm dependencies are deliberately NOT baked in: they change with the lockfile and
# are already fast via actions/setup-node's npm cache + `npm ci`. Azurite (the api
# CAS suite's emulator) installs as an api devDependency during that `npm ci`, so it
# needs no image layer either. This image is only the stable, expensive part — the
# browser and its OS libraries.
