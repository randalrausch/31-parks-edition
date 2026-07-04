# Custom CI runner image

The CI pipeline reinstalls the same slow toolchain — the Playwright browser and
its system dependencies — on a fresh VM for **every job of every run**, many times
a day. This image bakes that stable part once so jobs pull it instead of rebuilding
it. It cuts the pipeline's single slowest step (`playwright install --with-deps
chrome`, ~26s) to a near-instant image pull, and removes a class of flaky network
installs.

## What's in it

- **Node 20** and every **browser system library** (from the official
  `mcr.microsoft.com/playwright` base, pinned to the repo's `@playwright/test`
  version).
- **Google Chrome** (the E2E specs use `channel: "chrome"`).

`node_modules` is deliberately **not** baked — it changes with the lockfile and is
already fast via `actions/setup-node`'s npm cache + `npm ci`. Azurite installs with
that `npm ci` (it's an `api` devDependency), so it needs no image layer.

## How it's built

[`.github/workflows/ci-image.yml`](../workflows/ci-image.yml) builds
[`Dockerfile`](./Dockerfile) and pushes to
`ghcr.io/<owner>/31-parks-edition/ci:latest` (plus a commit-SHA tag). It runs when
the Dockerfile changes, weekly (to pick up Chrome/base security patches), and on
manual dispatch. Bump the `FROM` tag and the `playwright@` version together when
`@playwright/test` in `package.json` moves.

## Adopting it in a job (do this AFTER the image is first published)

The image must exist in GHCR before any job references it, so publish it first
(merge this directory, then run **Actions → Build CI image → Run workflow**). Then
switch a job to run inside it. For the `e2e` job in `ci.yml` — the biggest
beneficiary — that means adding a `container:` and dropping the now-redundant Chrome
install:

```yaml
  e2e:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/randalrausch/31-parks-edition/ci:latest
      # Only needed while the GHCR package is private; make it public to drop this.
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@... # v7
      # ... paths-filter, setup-node, npm ci ...
      # DELETE the "Install Chrome for E2E" step — Chrome is baked into the image.
      - name: E2E tests (Playwright)
        if: steps.changes.outputs.code == 'true'
        run: npm run test:e2e
```

Add `packages: read` to the workflow's top-level `permissions` so the job can pull
the image (or make the GHCR package public and skip `credentials`). The same
pattern applies to the deploy job's post-deploy "play the live deployment" step.

Roll it out one job at a time and confirm each is green before the next — a bad
image should only ever be able to redden the one job that opted in.
