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

## Deploys are gated on the gate

Both deploy paths only ship a commit the gate passed on:

- **Supabase / Netlify** — `ci.yml`'s own `deploy` job `needs: [gate, api, e2e,
  supabase-contract]`, so it never runs unless all four are green.
- **Azure** ([`azure.yml`](../.github/workflows/azure.yml)) — triggers on `ci.yml`'s
  **successful** completion on `main` (`workflow_run`). If any gate fails, `ci.yml`
  doesn't conclude success, so Azure never runs — a red test blocks the play31.fun
  deploy instead of racing it. It does **not** re-run the suite (`ci.yml` already
  did), and it deploys the exact commit `ci.yml` validated. A manual
  **Run workflow** on `azure.yml` bypasses the gate on purpose (rollback / redeploy).

A `feat:`/`fix:` merge deploys once, at the version-bump commit: `release.yml`
re-dispatches `ci.yml` with `reason=release`, and that run's success re-triggers the
Azure deploy of the correctly-versioned commit.
