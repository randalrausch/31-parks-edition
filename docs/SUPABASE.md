# Multiplayer backend (Supabase) — optional

Solo play needs **nothing** here. Online multiplayer uses a free
[Supabase](https://supabase.com) project as a server‑authoritative backend: a
Postgres table for lobby/state, Realtime for change pings, and one Edge Function
(`game`) that runs the *same* pure game rules the client uses and enforces
hidden information.

You can set it up in ~5 minutes — mostly with the included helper script.

## What you'll create

- A Supabase project (free tier).
- Two tables (`games`, `game_secrets`) + RLS, applied from
  `supabase/migrations/`.
- The `game` Edge Function, deployed from `supabase/functions/game`.
- A local `.env.local` with two **client‑safe** values.

## 1. Create the project

1. Sign in at <https://supabase.com/dashboard> → **New project**. Pick a name,
   a strong database password (save it), and a region. Wait ~2 minutes.
2. Open **Project Settings → API** and copy:
   - **Project URL** — `https://<ref>.supabase.co`
   - **Publishable key** — `sb_publishable_…` (or the legacy `anon` `eyJ…` key).
     Both are safe to ship in a client; they're protected by Row‑Level Security.
   - Your **project ref** is the `<ref>` part of the URL.

> Never commit the `service_role` (secret) key or your DB password. Only the
> URL + publishable/anon key go in the client.

## 2. Install & log in to the CLI

```bash
# macOS
brew install supabase/tap/supabase
# or: npm i -g supabase  (or use `npx supabase ...`)

supabase login    # opens a browser to authorize
```

## 3. Run the setup helper

From the repo root:

```bash
./scripts/setup-supabase.sh <project-ref> <publishable-key>
# e.g. ./scripts/setup-supabase.sh abcdefgh12345678 sb_publishable_xxx
```

It will (idempotently):

1. verify the CLI is installed and you're logged in,
2. `supabase link` to your project,
3. `supabase db push` (apply the schema migration),
4. `npm run build:edge` (bundle the shared engine for Deno),
5. `supabase functions deploy game`,
6. write `.env.local` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_KEY`.

Then:

```bash
npm run dev
```

The home screen now shows **Create Online Game** / **Join with Code**.

## Manual setup (if you prefer)

```bash
supabase link --project-ref <ref>
supabase db push
npm run build:edge
supabase functions deploy game
printf 'VITE_SUPABASE_URL=https://<ref>.supabase.co\nVITE_SUPABASE_KEY=<publishable-key>\n' > .env.local
```

Or apply `supabase/schema.sql` by hand in the dashboard SQL editor instead of
`db push`.

## How it stays secure

- The Edge Function is the **only** reader/writer of authoritative state (it
  uses the service key; anon clients are blocked by RLS).
- Each player gets a secret **seat token** on join; it's their identity for
  submitting actions. Only the player whose turn it is can act.
- Clients receive a **redacted** view (`redactState`) — never another player's
  cards. Realtime only carries a public lobby row (no card data) used as a
  "something changed, refetch" ping.
- Every write goes through the `commit_game` RPC, which bumps the version **and**
  saves the new state in one Postgres transaction — so a concurrent submit gets
  a clean conflict and the two rows can never half-commit.

## Optional function config (env / secrets)

The `game` function reads a few optional settings (set them as Supabase function
secrets — `supabase secrets set NAME=value` — or leave them unset for the
defaults):

| Var | Default | Effect |
|-----|---------|--------|
| `ALLOWED_ORIGIN` | `*` | Comma-separated origin allow-list for CORS (mirrors the Azure backend). Set it to your site's origin(s) to stop other sites calling the function. |
| `MAX_GAMES_PER_DAY` | `500` | Hard global cap on games created per day (durable, cross-instance). |
| `MAX_GAMES_PER_IP_PER_HOUR` | `20` | Per-IP games/hour cap. |

The two caps are enforced by a durable Postgres counter (`rate_counters` +
`incr_if_below`), so they hold across the ephemeral edge instances — not just
per-instance. Both are applied by the same migration as `commit_game`.

## Updating the function later

If you change shared logic in `src/game/` (`engine`/`actions`/`authority`),
re‑bundle and redeploy:

```bash
npm run build:edge && supabase functions deploy game
```

## Deploying the web app with multiplayer

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` as build‑time environment
variables in your static host (they're embedded at build time). See
[DEPLOY.md](DEPLOY.md). Without them, the app simply builds as solo‑only.

## Troubleshooting / observability

When an online game misbehaves, there are three logs to check:

- **Player-facing move log.** Every board shows a live "At the Table" feed of
  public actions, and the end-of-deal screen has a **"Show moves this deal"**
  toggle listing every public move (who drew/took/discarded/knocked).
- **Edge Function logs (server).** The `game` function emits one structured JSON
  line per request — `create`, `join`, `start`, and `act.ok` / `act.noop` /
  `act.conflict`, plus `error`. View them in the Supabase Dashboard →
  **Edge Functions → game → Logs**, or stream locally with
  `supabase functions logs game`. They include game ids, seat indices, action
  types, and versions — never seat tokens or card data.
- **Client debug logs (browser).** Network sync is traced under the `[31:net]`
  namespace. It's on automatically during `npm run dev`; on a deployed site,
  enable it from the console with
  `localStorage.setItem("parks31.debug", "1")` and reload (remove the key to
  turn it off).
