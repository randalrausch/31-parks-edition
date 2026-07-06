# CI/CD, testing, and release system review — July 2026

> **Status: implemented.** Every roadmap item below (and the follow-up round —
> canary, nightly fuzz, contract tripwires, mutation audit, OIDC deploys, the
> infra-drift reminder) landed via PRs #89, #91, and #92. This document is kept
> as the point-in-time audit; measurements and file references reflect the
> repo as of 2026-07-05.

A point-in-time audit of this repository's CI/CD, testing, release, and
automation system, measured against what best-in-class open-source projects do,
scoped to this project's size (a ~200-test TypeScript game, one maintainer,
small contributor base). Facts observed in the repo are separated from
recommendations throughout.

**TL;DR: this system is already at or above best-in-class for a project of this
size.** PR feedback lands in under a minute, every documented guarantee is
backed by a CI check, all actions are SHA-pinned with least-privilege tokens,
releases are fully automated with a human-escalation path, and deploys are
gated, ordered, smoke-tested by a real browser, and rollback-capable. The gaps
that remain are small: one stale doc claim, a missing single happy-path command,
two local gate lists that omit the format check, **Node 20 past end-of-life**,
and one genuine coverage gap — the online multiplayer flow is only
browser-tested *after* deploy, not at PR time.

---

## 1. Current-state map

### Workflow inventory

| Workflow | Triggers | Jobs | What it does |
| --- | --- | --- | --- |
| `ci.yml` (CI/CD) | push→`main`, every PR, manual dispatch (`deploy_ref` for rollback, `reason=release` internal) | `gate`, `api`, `e2e`, `supabase-contract`, `decide`, `deploy-supabase-netlify`, `deploy-azure` | Parallel quality gate + flag-gated deploys (see below) |
| `release.yml` | push→`main` | `release` | Conventional-Commits versioning: bumps `src/game/version.ts`, prepends `CHANGELOG.md`, rebuilds `engine.mjs`, tags, publishes a GitHub Release, re-dispatches the deploy; opens an issue instead of guessing when commits are ambiguous |
| `codeql.yml` | push/PR→`main`, weekly cron | `analyze` | CodeQL with the `security-extended` query suite |
| `ci-image.yml` | changes to the image definition or lockfile, weekly cron, manual | `build` | Builds the slim Chrome CI runner image → GHCR; PR-validates the Dockerfile without pushing |

### The quality gate (`ci.yml`), measured

Four **independent parallel jobs**; wall-clock is the slowest one, not the sum.
Measured from run [28731833943](https://github.com/randalrausch/31-parks-edition/actions/runs/28731833943)
(push to `main`, 2026-07-05) and recent PR runs:

| Job | Measured duration | Contents |
| --- | --- | --- |
| `gate` | **39 s** | `npm ci` (cached, 5 s) → typecheck → format check → lint → 199 unit/fuzz tests (~8 s) → CI-image drift guard → edge-bundle sync guard → production build |
| `api` | **38 s** | Azure package typecheck + the Table Storage CAS/atomicity suite against a real **Azurite** emulator (fails, not skips, if unreachable) + esbuild bundle |
| `e2e` | **44 s** | Real-browser Playwright (solo flow + axe accessibility scan) inside the prebuilt GHCR image — no browser install step |
| `supabase-contract` | **7 s** (no-op) / ~2–3 min when `supabase/**` changed | Boots a real local Postgres via `supabase start` and asserts the SQL contract (`supabase/tests/contract.sql`) with psql: `commit_game` CAS, `create_game` atomicity, anon EXECUTE revokes, RLS on secrets/join codes |
| **PR feedback total** | **~50 s – 2:40** | Docs-only PRs finish in ~48 s (paths-filter self-skip) |

Deploys: `decide` (12 s) resolves the ship decision once — including "a release
commit will supersede this push, don't double-deploy" via a dry-run of the
release driver — then one peer job per target, each an independent
`DEPLOY_*` repo-variable opt-in that costs zero runner time when off.
`deploy-azure` measured at ~4 min including a Function App warm-up loop and a
real Playwright session that **plays the live site** (solo turn + a two-browser
online round proving create/join/start/act and per-seat redaction end to end).
Backend always deploys before frontend so the live UI never calls a missing API.

Concurrency: superseded PR runs are cancelled; `main` runs never are (an
in-flight deploy always finishes) — `ci.yml:56-58`.

### Local automation

- **npm scripts** are the single command vocabulary (`package.json:20-48`):
  `typecheck`, `lint`, `format`/`format:check`, `test`/`test:coverage`/`test:watch`,
  `test:e2e`, `test:e2e:deploy`, `build`, `build:edge`, `api:*`, plus per-host
  deploy helpers. No Makefile — appropriate for a Node-only repo.
- **`scripts/`**: `release.mjs` + `lib/conventional.mjs` (the release driver —
  itself unit-tested in `scripts/lib/conventional.test.mjs`, which is rare and
  excellent), `check-ci-image.mjs` (image drift guard), `patch-swa-csp.mjs` and
  `stamp-sw-cache.mjs` (postbuild), `new-theme.mjs`, `setup-{azure,supabase}*.sh`.
- **`.claude/`**: allow-listed safe commands, a `SessionStart` dependency-install
  hook, three review agents (security / SRE / parity), and five commands
  (`/precommit`, `/edge-sync`, `/add-option`, `/deploy-smoke`, `/parity-check`).
- **`.devcontainer/`**: Node 20 image + Azure tooling, auto-`npm ci` on create.
- **Dependabot** (`.github/dependabot.yml`): weekly npm (root, dev-deps grouped),
  npm (`/api`), and github-actions ecosystems.

### Secrets, tokens, permissions

| Credential | Used by | Scope |
| --- | --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` | gate build, Netlify deploy | Client-safe by design (anon key, RLS-guarded); absent on fork PRs → build still passes, online UI hides |
| `NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID` | deploy-supabase-netlify | Deploy-only |
| `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / `SUPABASE_DB_PASSWORD` | deploy-supabase-netlify | Migrations + function deploy |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` / `AZURE_STATIC_WEB_APPS_API_TOKEN` | deploy-azure | Deploy-only |
| `RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY` | release.yml | GitHub App with **Contents: RW only**, on the `main` ruleset bypass list; token minted per-run, used only for the version-bump push |
| `GITHUB_TOKEN` | everywhere else | Top-level `permissions:` blocks are minimal per workflow (`contents: read` + `packages: read` in ci.yml; `contents/issues/actions: write` only in release.yml) |

Deploy secrets only reach the `deploy-*` jobs, which run on `main`
push/dispatch — never on PRs. No `pull_request_target` anywhere. Forks can run
the full gate safely.

---

## 2. Developer experience — findings

**What works** (verified in this session):

- Clone → `npm install` → `npm run dev` is real; solo play needs zero config.
- The full unit suite runs in **6.6 s locally** (199 tests, 23 files). Typecheck,
  lint, and build are each seconds. Small changes are genuinely fast to validate.
- README, CONTRIBUTING, `docs/CI.md`, `docs/TESTING.md`, `docs/DEPLOY.md` are
  accurate against the actual workflows (spot-checked; one exception below) and
  explain *why*, not just *what*. Issue forms + a PR template with the exact CI
  checklist exist. `AGENTS.md` symlinks `CLAUDE.md` so all agent tooling gets
  project instructions.
- Failure messages are engineered: the edge-bundle and CI-image guards fail
  with the exact fix command (`ci.yml:102-106`, `scripts/check-ci-image.mjs`).

**Gaps:**

1. **No single happy-path command.** CONTRIBUTING.md and the PR template list
   six commands to run before a PR. Best-in-class repos give you one
   (`npm run check` / `make test`). *(Fact: no aggregate script exists in
   `package.json`.)*
2. **Two local gate lists omit `format:check`.** CI's `gate` job fails on
   Prettier drift (`ci.yml:89-90`), but `CLAUDE.md` → "Checks before committing"
   and `.claude/commands/precommit.md` both list only
   typecheck/lint/test/build(+api). A contributor (or agent) following either
   list can pass locally and fail CI on formatting. *(docs/TESTING.md:71 does
   include it — the three lists disagree.)*
3. **Devcontainer can't run `test:e2e` out of the box** — Playwright uses
   `channel: "chrome"` and the devcontainer's `postCreateCommand` never installs
   Chrome.

---

## 3. CI quality — assessment

| Dimension | Verdict | Evidence |
| --- | --- | --- |
| Speed | **Excellent** | Sub-minute PR gate; parallel job shape means wall-clock = slowest job; npm cache keyed on both lockfiles |
| Reliability | **Excellent** | Last 10 `ci.yml` runs all green; the flakiest step (cold Chrome download) was engineered away via the prebuilt image; Playwright retries once in CI with trace-on-retry |
| Caching | Good | `actions/setup-node` npm cache everywhere it matters; the CI image caches the OS/browser layer |
| Waste avoidance | **Excellent** | Docs-only diffs self-skip heavy jobs (fail-open path filters — an unlisted path *runs* the suite, `ci.yml:129-148`); the Docker-heavy Postgres job only boots when `supabase/**` changed; release re-dispatch skips the already-tested gate (code tested once per change, not twice); superseded PR runs cancelled; disabled deploy targets cost zero minutes; Netlify deploys prebuilt `dist/` (zero Netlify build minutes) |
| Matrix strategy | Correctly absent | One deploy runtime (Node 20 today); a Node matrix would be vanity |
| Required checks / branch protection | Documented, not verifiable in-repo | `docs/CI.md:23-45` names exactly `gate`, `api`, `e2e`, `supabase-contract`, `CodeQL` and explains the traps (don't require the image build; skipped required checks pass). **Verify the live ruleset matches** — settings drift silently |
| PR feedback clarity | **Excellent** | Guards emit `::error` with the fix; jobs are named for what they check |
| Duplication | None found | The deploy jobs rebuild but deliberately don't re-test (`ci.yml:472-473`) |

Minor observations (accepted risks, worth knowing):

- The e2e job's container image is **mutable `:latest`** and rebuilt weekly — a
  bad weekly publish or Chrome regression can redden CI without a repo change.
  The SHA-tagged fallback exists in GHCR if that ever happens. Fine at this
  scale; pinning by digest would add update ceremony for little gain.
- `release.yml`'s `git push origin HEAD:main` can lose a race with a human merge
  landing mid-run; the failed run is self-healing (the next push re-triggers)
  but a rerun is manual. Low frequency, low cost — acceptable.
- `ci.yml:193` hardcodes `ghcr.io/randalrausch/31-parks-edition/ci:latest`
  while `ci-image.yml:60` derives the image name from `github.repository`. A
  fork running CI in its own repo pulls the upstream image (works only while
  that package is accessible). Portability nit, not a security issue.

---

## 4. Testing strategy — assessment

The layering is textbook: cheapest first, each layer covering what the previous
can't, and — the distinctive part — **every documented guarantee has a named
test** (redaction → `redactFuzz.test.ts`; CAS → Azurite/psql suites; RPC grants
→ `schema.grants.test.ts`; IP spoofing → `clientIp.test.ts`; release logic →
`conventional.test.mjs`).

| Layer | Where | Coverage quality |
| --- | --- | --- |
| Unit + property/fuzz | 23 `*.test.ts` files, 199 tests, 6.6 s | Rules engine invariants (card conservation, termination, one winner), hidden-info fuzz across random games, the shared op layer + router against `MemoryGameStore` |
| Store contracts | `storeContract.test.ts` shared suite; Azurite (real emulator) in CI; fake supabase-js locally | Pins the "no lost updates" CAS guarantee; **fails rather than skips** when the emulator is missing |
| SQL contract | `supabase-contract` job, real Postgres | Closes the "migration edit passes the fake-backed suite" gap |
| Browser E2E (PR) | `e2e/game.spec.ts` (solo flow) + `e2e/a11y.spec.ts` (axe, WCAG 2.1 A/AA, serious/critical blocking) | Real Chrome against the production build |
| Deploy smoke (post-ship) | `e2e/deployment.spec.ts` — boots, plays a solo turn, runs a **two-browser online round** against the live backend | Proves redaction and the full create/join/start/act path in production |

**The one genuine gap: the online flow has no PR-time browser test.** The
two-browser online round exists only in the *post-deploy* smoke. The op layer
and stores are unit-covered, and `useNetworkGame` has hook-level tests, but
`OnlineGameBoard` + transport + polling in a real browser is first exercised
*after* shipping. Given that board/adapter parity drift is this project's
self-identified signature hazard (CLAUDE.md, the `parity-auditor` agent), this
is the highest-value test to add: the shared `makeRouter` + `MemoryGameStore`
can be hosted in a ~50-line Node HTTP server, the build pointed at it via
`VITE_API_BASE`, and the existing two-browser spec re-aimed at localhost.
Online regressions would then fail the PR, not the deploy smoke.

Second-order gaps, already known and correctly triaged in `docs/TESTING.md`:
`useGame` presentation sequencing (tracked as future state-machine extraction),
load/soak (reasonable non-goal; rate limits are unit-tested).

**Doc drift found:** `docs/TESTING.md:62-64` still says "there is no automated
axe/a11y audit yet" — `e2e/a11y.spec.ts` has existed since PR #63.

Coverage tooling exists (`test:coverage`, v8) but no CI signal. Recommendation:
leave thresholds out (vanity risk); optionally print the summary on `main` runs.

---

## 5. Security & supply chain — assessment

| Control | Status |
| --- | --- |
| Action pinning | **Every** third-party and first-party action is SHA-pinned with a version comment, across all four workflows |
| Workflow permissions | Minimal per workflow; no default write anywhere; release scopes documented |
| Third-party actions | Only well-known ones (checkout, setup-node, paths-filter, supabase/setup-cli, Azure deploy actions, codeql, create-github-app-token); the image build deliberately uses the docker CLI instead of a third-party action (`ci-image.yml:46-50`) |
| Fork safety | Gate runs secret-free on fork PRs (build degrades gracefully); deploys unreachable from PRs; no `pull_request_target` |
| CodeQL | Weekly + push/PR, `security-extended` |
| Dependency updates | Dependabot: npm ×2 + github-actions, weekly, dev-deps grouped |
| Release privilege | GitHub App with Contents-RW only, bypass-listed, per-run token; documented setup and a no-App fallback (`docs/CI.md:71-128`) |
| Secrets in code | None found; `.env.example` documents client-safe values only; `SECURITY.md` has a real threat model with per-threat test citations |
| Domain-specific SAST | `schema.grants.test.ts` (RPC grant enforcement) and the psql RLS contract are effectively custom security regression tests — better than generic tooling for this codebase |

Not present, with a recommendation each:

- **Workflow linting** (`actionlint`, optionally `zizmor`): this repo edits its
  workflows *often* (9 of the last 25 commits are `ci:`), and workflow bugs
  currently surface only at run time. A pinned actionlint step in `gate` is
  cheap and catches expression/needs/shell mistakes at PR time. **Recommended.**
- **GitHub-side settings** (not verifiable from the repo): confirm secret
  scanning + push protection are enabled, and that the `main` ruleset matches
  `docs/CI.md`. **Essential to verify, zero code.**
- **Dependabot `docker` ecosystem** for `.github/ci-image/Dockerfile`: the
  weekly rebuild already picks up `node:20-*` patches; a major-version bump is
  guarded by `check-ci-image.mjs` against `.nvmrc`. Marginal — optional.
- **SBOM / artifact signing / provenance / OpenSSF Scorecard**: **not
  recommended.** Nothing is published as a package or container for consumption;
  the deploy artifact is a static site. This would be ceremony without a
  consumer.

---

## 6. Release & deployment — assessment

**Facts:** single version source (`src/game/version.ts`) read by frontend and
both backends; Conventional Commits drive semver via a *tested* driver;
pre-1.0 breaking changes bump minor (no accidental 1.0.0); ambiguous commits
open an issue instead of guessing; a tags-behind-version integrity guard
refuses to re-count released history (`scripts/release.mjs:126-146` — this
class of bug already happened once, v0.2.2/v0.2.3, and is now pinned);
changelog + GitHub Release generated; the version-bump commit is `[skip ci]`
and the deploy is explicitly re-dispatched so exactly one tested deploy ships
per change; rollback = manual dispatch with `deploy_ref` to any known-good tag;
`PROTOCOL_VERSION` (wire) and `STATE_VERSION` (serialized games) are separate
manual bumps with client-refresh / clear-error semantics so live games can't
silently break across a deploy.

**Verdict: this is a more complete release system than most popular OSS
projects have.** The remaining honest caveats: SQL migrations roll *forward*
only (a `deploy_ref` rollback doesn't un-migrate — standard, worth a sentence in
`docs/CI.md`), and there are no environment protection rules/approval gates
(appropriate: a solo maintainer with flag-gated targets doesn't need staged
approvals; the post-deploy playable smoke is the stronger control).

---

## 7. Documentation — assessment

README (badges: play-link, CI, release, license; accurate quick start),
CONTRIBUTING (commands match CI; conventions include the parity rule and
hidden-info invariant), `docs/CI.md` (structure + required checks + release
setup), `docs/TESTING.md` (layers *and* explicit non-goals), `docs/DEPLOY.md`,
`docs/AZURE.md`, `docs/SUPABASE.md`, `docs/ARCHITECTURE.md`, three ADRs,
`SECURITY.md` (real threat model), SUPPORT, CODE_OF_CONDUCT, ROADMAP, generated
CHANGELOG. Docs consistently explain *why* (e.g. why psql instead of
supabase-js in the contract job, `ci.yml:246-253`).

Issues: the TESTING.md a11y drift (§4), and the three disagreeing pre-commit
lists (§2). Both trivial fixes.

---

## 8. Best-in-class comparison

Things this repo does that even flagship OSS projects usually don't:

- Post-deploy smoke that **plays the product** (two browsers, live backend,
  redaction assertion) rather than curling a health endpoint.
- Drift guards with the fix in the error message (edge bundle, CI image ×
  lockfile × `.nvmrc`).
- A release bot that **asks a human** (via issue) when classification is
  ambiguous, and refuses to release when tags are out of sync.
- Real-infrastructure contract tests (Azurite + real Postgres) that fail rather
  than skip when the infrastructure is missing.
- A unit-tested release script.
- Deliberate cost engineering: path-filtered Docker jobs, prebuilt slim image,
  zero-minute disabled targets, Netlify prebuilt deploys, capped Azure scale-out.

Where the very best still lead:

| Practice | Gap here | Worth closing? |
| --- | --- | --- |
| One-command local gate | Missing | **Yes — quick win** |
| PR-time E2E of the full product surface | Online flow post-deploy only | **Yes — the one real test gap** |
| Runtime currency | Node 20 is **EOL (April 2026)** across `.nvmrc`, 7× `node-version: 20`, the CI image base, the devcontainer, `engines` | **Yes — near-term** |
| Workflow linting | None | Cheap yes |
| Coverage visibility | None | Optional, summary-only |
| Merge queue, environment protections, Renovate, signed provenance | Absent | **No — wrong scale; would add burden without benefit** |

---

## 9. Prioritized roadmap

### Quick wins (0–2 h)

1. **Add a single happy-path command** — *essential*.
   `package.json`: `"check": "npm run format:check && npm run typecheck && npm run lint && npm test && npm run build"`
   (optionally `"check:all"` adding `api:typecheck`/`api:test` + `test:e2e`).
   Update CONTRIBUTING.md, PR template, and TESTING.md to lead with it.
   Benefit: the six-command checklist becomes one; beginners can't run the wrong
   subset. Risk: none.
2. **Fix the TESTING.md a11y drift** (`docs/TESTING.md:62-64`) — *essential,
   5 min*. The a11y audit exists; say so (and keep the load/soak non-goal).
3. **Align the three pre-commit lists** — *essential*. Add `format:check` to
   `CLAUDE.md` → "Checks before committing" and `.claude/commands/precommit.md`
   (or have both just invoke `npm run check`).
4. **Single-source the Node version in workflows** — *recommended*. Replace the
   seven hardcoded `node-version: 20` blocks with
   `node-version-file: ".nvmrc"`. Makes the Node 22 bump (below) a two-file
   change (`.nvmrc` + Dockerfile) that `check-ci-image.mjs` already guards.
5. **Verify GitHub settings match the docs** — *essential, zero code*: `main`
   ruleset requires exactly the five checks in `docs/CI.md`; secret scanning +
   push protection enabled.
6. **Add actionlint to the `gate` job** — *recommended*. Pin the binary
   download by SHA (matching house style) and run it over `.github/workflows/`.
   Benefit: this repo's most-edited, least-tested code (the workflows) gets a
   PR-time check. Risk: none; it's read-only.

### Near-term (1–2 days)

7. **Bump Node 20 → 22 LTS** — *essential*. Node 20 reached end-of-life
   April 2026; the CI image base (`node:20-bookworm-slim`) stops receiving the
   weekly security patches the schedule exists for. Files: `.nvmrc`,
   `.github/ci-image/Dockerfile` (base image), `.devcontainer/devcontainer.json`,
   `engines` in both `package.json`s; workflows follow automatically after
   quick-win 4. The existing drift guard fails loudly if any pin is missed.
   Risk: low (run the full gate + e2e; Azure Functions Node 22 support is GA).
8. **PR-time online-flow E2E against a local backend** — *essential; the
   highest-value test addition*. Add a tiny dev server (`e2e/localServer.mjs`,
   ~50 lines: Node `http` + the shared `makeRouter` + `MemoryGameStore` — all
   existing exports), build with `VITE_API_BASE=http://localhost:<port>`, and
   run the existing two-browser round from `deployment.spec.ts` against it in
   the `e2e` job. Benefit: online regressions and board-parity breaks fail the
   PR instead of the post-deploy smoke; the deploy smoke remains as the
   production-truth layer. Effort: ~1 day. Risk: moderate (a second webServer in
   Playwright config; keep it a separate project so the solo suite stays
   independent).
9. **Devcontainer: install Chrome** (`npx playwright install chrome` in
   `postCreateCommand`) so `test:e2e` works there — *recommended, 15 min*.

### Medium-term (1–2 weeks) — only as they earn their keep

10. **Extract presentation sequencing into a testable state machine** — already
    tracked as future work in TESTING.md; do it when `useGame` next changes
    materially, not before. *Recommended-later.*
11. **Coverage summary on `main`** (`vitest --coverage` + job summary, no
    thresholds, no badge service) — *optional*. Visibility without vanity.
12. **Fork-portable CI image reference** (derive the e2e `container.image` from
    the repo name, or document the fork steps in `ci-image/README.md`) —
    *optional*; only matters if fork-based development becomes common.

### Long-term

None justified. Explicitly **not** recommended at this scale: merge queues,
Renovate migration, SBOM/signing/provenance, container scanning beyond the
weekly rebuild, DAST, staged environments with approval gates, multi-Node
matrices. Each adds maintenance burden without a consumer or a threat that
warrants it — and keeping the system understandable to beginners is a stated
project goal the current design serves well.

---

## 10. Target architecture

Keep the current shape — it is the right one:

```
PR/push ──► gate (≤40s) ─┐
        ──► api  (≤40s) ─┤
        ──► e2e  (≤45s) ─┼──► decide ──► deploy-supabase-netlify (flag)
        ──► supabase-    │    (main only)  deploy-azure (flag)
            contract ────┘                   └─► live playable smoke
push(main) ──► release.yml ──► version+tag+Release ──► re-dispatch deploy only
weekly     ──► codeql · ci-image rebuild
```

The deltas from this review slot into existing boxes: `npm run check` in front
of it all, the online round moving left into `e2e`, actionlint inside `gate`,
Node 22 underneath everything.
