# Documentation index

Guides for playing, contributing to, and operating **31 · National Parks Edition**.

## Start here

- [../README.md](../README.md) — what the game is, how to run it, project layout.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — dev workflow, the pre-PR gate, and
  conventions (keep the core pure, hidden info is sacred, keep the two boards and
  two adapters in parity).

## How it's built

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pure engine, reducer, transports,
  and authority fit together, and how hidden information is enforced.
- [adr/](adr/) — Architecture Decision Records: the *why* behind the big choices.
  - [0001 — one engine, two front ends, two back ends](adr/0001-one-engine-two-frontends-two-backends.md)
  - [0002 — two interchangeable storage backends](adr/0002-swappable-storage-backends.md)
  - [0003 — a wire `PROTOCOL_VERSION`](adr/0003-protocol-version.md)
- [TESTING.md](TESTING.md) — the test layers (unit/fuzz → local E2E → live-site
  deployment smoke) and what each covers.

## Running your own online backend (both optional)

- [AZURE.md](AZURE.md) — Azure Functions + Table Storage + Static Web Apps via one
  `azd up`; scales to zero and auto-wakes.
- [SUPABASE.md](SUPABASE.md) — Supabase Edge Function + Postgres, one-command setup.
- [DEPLOY.md](DEPLOY.md) — deploy the static build to any host.

## Extending the game

- [THEMES.md](THEMES.md) — add your own national park theme (mostly art + a
  palette + one registry entry).
