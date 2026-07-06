# CI structure & branch protection

The quality gate in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs
as **four parallel jobs** (plus a deploy job that waits on them):

| Job | What it runs | Runs on |
| --- | --- | --- |
| `gate` | typecheck · format · lint · workflow lint (actionlint) · unit/fuzz tests (with a coverage summary on `main`) · edge-bundle sync · CI-image sync · build | every push & PR |
| `api` | Azure Functions typecheck + Table Storage (Azurite) CAS suite + build | every push & PR |
| `e2e` | real-browser Playwright inside the prebuilt CI image: solo flow, axe accessibility scan, and a two-browser online round against a local in-memory backend (`e2e/localServer.ts`) | every push & PR |
| `supabase-contract` | boots a real local Postgres (`supabase start`) and asserts the SQL contract with psql — `commit_game` CAS, `create_game` atomicity, anon RPC-EXECUTE revokes, and the RLS hiding `game_secrets` / the join code | every push & PR |
| `deploy` | builds with secrets, ships enabled targets, runs the post-deploy smoke | push to `main` only |

CodeQL ([`codeql.yml`](../.github/workflows/codeql.yml)) runs in parallel as the
`CodeQL` check, and `dependency-review` (in `ci.yml`, PRs only) fails a PR that
*introduces* a dependency with known high-severity vulnerabilities — the gap
Dependabot (which only updates existing deps) doesn't cover. The `e2e` job
uploads its Playwright traces as a `playwright-test-results` artifact **on
failure**, so a CI-only E2E failure is debuggable in the trace viewer.

Two scheduled workflows watch for rot between pushes:

| Workflow | Cadence | What it does |
| --- | --- | --- |
| [`canary.yml`](../.github/workflows/canary.yml) | weekly | Plays the **live site** (solo turn + two-browser online round) against `AZURE_SITE_URL`; opens/refreshes an issue on failure. Self-skips when the variable isn't set. |
| [`nightly-fuzz.yml`](../.github/workflows/nightly-fuzz.yml) | nightly | Runs the property/fuzz suites at 50× iterations with a fresh seed per run (PR runs stay small and deterministic — see `src/game/fuzzRig.ts`); opens an issue carrying the reproducing seed on failure. |

`api` and `e2e` self-skip their heavy steps on a docs/meta-only diff, and
`supabase-contract` only boots the Docker stack when `supabase/**` (or its own
contract suite) changed — otherwise it no-ops green in seconds. All four skip on the
release re-dispatch (`reason=release`) — but the **jobs still report a result on
every PR**, so they're safe to require.

## Required status checks (set this in repo settings)

**Settings → Branches → branch protection rule for `main`** (or **Rules → Rulesets**),
under _Require status checks to pass before merging_, require exactly:

- `gate`
- `api`
- `e2e`
- `supabase-contract`
- `CodeQL`

The intended ruleset is also committed as [`docs/ruleset.json`](ruleset.json)
(Settings → Rules → Rulesets → **Import a ruleset**) so the protection is
reviewable and restorable instead of living only in Settings. After importing,
add the release GitHub App to the ruleset's **bypass list** by hand — that's an
account-specific id an import can't carry (see [Release automation](#release-automation-extra-setup-beyond-git-clone)).
Do **not** require `dependency-review` — it's PR-only by nature (it diffs
base..head) but new; leave it informational until it has some history.

Notes:

- **Remove `ci-cd`** if it's still listed — the pipeline used to be one job by that
  name; it no longer exists (it was split into the three above), and a required
  check that never reports blocks every PR.
- **Do not require `build`** (the CI-image build check from
  [`ci-image.yml`](../.github/workflows/ci-image.yml)). It only runs on PRs that
  touch the Dockerfile / lockfile, so requiring it would leave every other PR stuck
  waiting on a check that never starts. Leave it informational.
- The `reason=release` skip only fires on the internal release re-dispatch, never on
  a PR, so requiring the three gate jobs stays correct. (GitHub also treats a skipped
  required check as passing.)

## Deploys — one gate, one job per target

Every deploy target lives in `ci.yml` as a peer job, gated on the same green gate
(so a red test ships nothing) and **skipped entirely when its flag is off** (zero
runner time for a disabled target):

| Job | Ships | Runs when |
| --- | --- | --- |
| `decide` | — (makes the ship decision once) | push/dispatch to `main`, no gate failed |
| `deploy-supabase-netlify` | Supabase backend and/or the Netlify frontend | `DEPLOY_SUPABASE` or `DEPLOY_NETLIFY` is `true` |
| `deploy-azure` | Azure Function App + Static Web App | `DEPLOY_AZURE` is `true` |

All deploy jobs `needs:` the gate through `decide`, so a failed `gate` / `api` /
`e2e` / `supabase-contract` skips `decide` and every target — a red test blocks the
deploy, it never races it. The suite is **not** re-run in the deploy jobs; they only
build + ship the exact commit the gate validated. Inside `deploy-supabase-netlify`
the frontend build runs only when Netlify is on (Supabase is backend-only), so
nothing is built for a target that isn't shipping.

A `feat:`/`fix:` merge deploys once, at the version-bump commit: `release.yml`
re-dispatches `ci.yml` with `reason=release` (gate jobs skip; the deploy jobs ship
the correctly-versioned commit). A manual **Run workflow** on `ci.yml` with a
`deploy_ref` redeploys/rolls back all enabled targets.

> **Rollback caveat:** SQL migrations roll **forward only** — redeploying an
> older `deploy_ref` reships that commit's code but does not (and cannot)
> un-apply migrations the newer deploy already ran. Keep migrations
> backward-compatible with the previous release so a code rollback stays safe.

## Release automation (extra setup beyond `git clone`)

Releases are cut automatically by [`release.yml`](../.github/workflows/release.yml)
on every push to `main`: a `feat:`/`fix:` commit bumps `src/game/version.ts`,
regenerates the edge bundle, updates the changelog, commits
`chore(release): vX.Y.Z [skip ci]`, tags it, publishes a GitHub Release, and
dispatches the deploy.

That version-bump commit is pushed **directly to `main`** — and because `main`
requires status checks on every push (see [Required status checks](#required-status-checks-set-this-in-repo-settings)),
the default `GITHUB_TOKEN` **cannot** push it: GitHub rejects it with
_"N of N required status checks are expected."_ So the push authenticates as a
**GitHub App** that sits on the ruleset's **bypass list**. Wiring that App up is
the one thing a fork or self-host must do — beyond cloning — for releases to work.

### One-time setup (repo owner)

1. **Create a GitHub App** at <https://github.com/settings/apps> → _New GitHub App_.
   - Name it anything (e.g. `<your-repo>-release-bot`); Homepage URL can be the repo.
   - **Uncheck** _Webhook → Active_ (this App needs no webhook).
   - **Repository permissions → Contents: Read and write** — the _only_ permission
     it needs (it just pushes the version-bump commit + tag). Leave the rest at
     _No access_.
   - _Where can this App be installed?_ → **Only on this account**.
   - Create it, then **Generate a private key** (downloads a `.pem`).
2. **Install the App** on this repo: the App's page → _Install App_ → your account →
   _Only select repositories_ → pick this repo.
3. **Add two repository secrets** (Settings → Secrets and variables → Actions):
   - `RELEASE_APP_ID` — the App's numeric _App ID_ (from its _General_ page).
   - `RELEASE_APP_PRIVATE_KEY` — the **entire** `.pem` contents, including the
     `-----BEGIN…`/`-----END…` lines.
4. **Add the App to the `main` ruleset's bypass list**: Settings → Rules → Rulesets
   → open the ruleset targeting `main` → _Bypass list_ → _Add bypass_ → select your
   App → mode **Always** → Save.

The next `feat:`/`fix:` merge then releases and deploys on its own.

Under the hood, `release.yml` mints a short-lived installation token from those two
secrets via [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
and uses it **only** for the push to `main`. The tag push, the GitHub Release, the
"ask a human" issue, and the deploy dispatch all keep using the built-in
`GITHUB_TOKEN` (none of those are blocked by the branch rule). Nothing long-lived
is stored except the App's private key, and the token itself lives only for the
length of one job.

### Alternative: bypass with the built-in Actions token

If you'd rather not create an App, add the built-in **GitHub Actions** actor to the
`main` ruleset's bypass list instead and skip the two secrets. `release.yml` falls
back to `GITHUB_TOKEN` when `RELEASE_APP_ID` is unset, and that push then bypasses.
Whether the plain Actions token is selectable as a bypass actor depends on your
plan/ruleset UI — if it isn't offered, use the App above.

### No branch rule? No setup needed

If your fork's `main` has **no** required-status-checks rule, releases work with
zero extra setup — the fallback `GITHUB_TOKEN` push isn't blocked. The App is only
needed because this repo protects `main` with required checks.
