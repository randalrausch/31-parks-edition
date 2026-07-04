# Roadmap

A rough, non-binding sense of where 31 · National Parks Edition is headed. It's a
hobby project — priorities shift, and community contributions can reorder any of
this. Have an idea? Open a [Discussion](https://github.com/randalrausch/31-parks-edition/discussions)
or an issue.

## Always welcome (great first contributions)

- **More national parks.** The highest-leverage contribution — mostly art plus a
  palette plus one registry entry, no code required for the easy path. See
  [docs/THEMES.md](docs/THEMES.md). Parks we'd love: **Yosemite, Zion, Grand
  Canyon, Acadia, Great Smoky Mountains, Olympic, Sequoia, Arches**.
- **Opponent portraits and card-back art** for existing themes (see
  `src/assets/chars/README.md` and `src/assets/parks/README.md`).
- **AI opponents** — a name, a catchphrase, and five trait numbers in
  `src/game/aiCharacters.ts`.

## Near term

- **Run the shared store contract against real Postgres in CI** (`supabase start`)
  when `supabase/**` changes. The contract already runs against the Supabase fake,
  the memory store, and real Azurite; adding a real-Postgres run closes the last
  gap where a migration edit to the `commit_game` SQL could pass CI.

## Later / maybe

- Persisted per-game state versioning with a migration path (so an engine change
  can't strand in-flight online games — the solo save already validates + quarantines).
- A third backend adapter (e.g. Cloudflare D1 / Durable Objects) purely to
  demonstrate the storage seam — the adapter-contract suite is the substitute
  that proves the seam today.
- Optional accounts / stats, and rule variants beyond the current house rules.

## Non-goals

See [SECURITY.md](SECURITY.md#explicit-non-goals) — no accounts-required identity,
no anti-collusion between players sharing hands out of band, and no heavyweight
anti-abuse beyond the lightweight rate limiting already in place.
