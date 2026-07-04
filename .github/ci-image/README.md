# Custom CI runner image

The CI pipeline reinstalls the same slow toolchain — the Playwright browser and
its system dependencies — on a fresh VM for **every job of every run**, many times
a day. This image bakes that stable part once so jobs pull it instead of rebuilding
it. It cuts the pipeline's single slowest step (`playwright install --with-deps
chrome`, ~26s) to a near-instant image pull, and removes a class of flaky network
installs.

## What's in it

- **Node 20** (a slim `node:20-bookworm-slim` base).
- **Google Chrome** and its system libraries (`playwright install --with-deps
  chrome`, pinned to the repo's `@playwright/test` version).

Only Chrome — the browser the E2E specs actually launch (`channel: "chrome"`). The
official Playwright base image also bundles Chromium, Firefox, and WebKit (~2GB)
that this project never uses, which made the e2e job's cold pull slower than the
install it replaced; the slim base roughly halves the image and the pull.

`node_modules` is deliberately **not** baked — it changes with the lockfile and is
already fast via `actions/setup-node`'s npm cache + `npm ci`. Azurite installs with
that `npm ci` (it's an `api` devDependency), so it needs no image layer.

## How it's built

[`.github/workflows/ci-image.yml`](../workflows/ci-image.yml) builds
[`Dockerfile`](./Dockerfile) and pushes to
`ghcr.io/<owner>/31-parks-edition/ci:latest` (plus a commit-SHA tag). It runs when
the Dockerfile changes, weekly (to pick up Chrome/base security patches), and on
manual dispatch. On a **pull request** that touches the Dockerfile it builds without
pushing, so a broken image is caught before merge; the build logs the image size.
Bump the `playwright@` version when `@playwright/test` in `package.json` moves — the
drift guard below fails the build until you do.

## Keeping it fresh — how you'll know it needs an update

Three layers, so a stale image can't slip through unnoticed:

1. **Automatic, on a schedule** — the build workflow runs **weekly**, so Chrome and
   the base image pick up security patches without anyone doing anything.
2. **Automatic, on dependency changes** — it also rebuilds whenever
   `package-lock.json` changes on `main`, so a `@playwright/test` bump republishes
   the image to follow.
3. **A blocking guard that notifies you** — `scripts/check-ci-image.mjs` runs in the
   `gate` job on every PR. If the Dockerfile drifts from the repo — its Playwright
   pin vs the lockfile's `@playwright/test`, or its `node:XX` base vs `.nvmrc` —
   **CI fails with the exact fix**. So bumping `@playwright/test` to a new minor, or
   `.nvmrc` to a new Node major, without updating the image is caught at PR time, not
   from a weird test failure later. Run it locally too: `node scripts/check-ci-image.mjs`.

So the only manual step is the one that genuinely needs a human decision: when a
Playwright **minor/major** bump lands, set both pins in the [`Dockerfile`](./Dockerfile)
to the new `vX.Y.Z` (the guard tells you the number). Patch bumps are tolerated —
the E2E specs use the system Chrome channel, which isn't tied to Playwright's patch.

Other automation options, if you want less hand-editing still:
- **Dependabot** (`.github/dependabot.yml`, `docker` + `npm` ecosystems) will open PRs
  bumping the base image and `@playwright/test` — the guard then keeps the two in step.
- **Fully hands-off**: parameterize the Dockerfile's version as a build `ARG` and have
  the build workflow inject it from the lockfile, so the image always matches with no
  Dockerfile edit. The guard becomes a belt-and-suspenders check. (Not done here to
  keep the Dockerfile the obvious single source of truth — say the word to switch.)

## Which jobs use it

The `e2e` job in `ci.yml` already runs inside the image (see its `container:` block)
and no longer installs Chrome. The pattern, for reference and for adopting it
elsewhere:

```yaml
  e2e:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/randalrausch/31-parks-edition/ci:latest
      # Needed while the GHCR package is private; make it public to drop this.
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    steps:
      # ... checkout, paths-filter, setup-node, npm ci ...
      # No "Install Chrome" step — Chrome is baked into the image.
      - name: E2E tests (Playwright)
        run: npm run test:e2e
```

This needs `packages: read` in the workflow's top-level `permissions` (already set)
so the job can pull the image, or make the GHCR package public and drop `credentials`.

**Still on the old path:** the deploy job's post-deploy "play the live deployment"
step still runs `playwright install --with-deps chrome`. It only executes when
`DEPLOY_NETLIFY` is enabled (currently off), so it's left as-is; it can adopt the
same `container:` pattern when deploys are turned on. Roll any such change out one
job at a time and confirm green before the next — a bad image can then only redden
the single job that opted in.
