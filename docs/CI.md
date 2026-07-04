# CI structure & branch protection

The quality gate in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs
as **four parallel jobs** (plus a deploy job that waits on them):

| Job | What it runs | Runs on |
| --- | --- | --- |
| `gate` | typecheck · format · lint · unit/fuzz tests · edge-bundle sync · CI-image sync · build | every push & PR |
| `api` | Azure Functions typecheck + Table Storage (Azurite) CAS suite + build | every push & PR |
| `e2e` | real-browser Playwright, inside the prebuilt CI image | every push & PR |
| `supabase-contract` | boots a real local Postgres (`supabase start`) and asserts the SQL contract with psql — `commit_game` CAS, `create_game` atomicity, anon RPC-EXECUTE revokes, and the RLS hiding `game_secrets` / the join code | every push & PR |
| `deploy` | builds with secrets, ships enabled targets, runs the post-deploy smoke | push to `main` only |

CodeQL ([`codeql.yml`](../.github/workflows/codeql.yml)) runs in parallel as the
`CodeQL` check.

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
