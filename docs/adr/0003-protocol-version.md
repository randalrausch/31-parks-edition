# ADR 0003 — A wire `PROTOCOL_VERSION` separate from the app version

- Status: Accepted
- Date: 2026-07

## Context

`APP_VERSION` (human semver) is bumped automatically by the release workflow from
Conventional Commits — it changes on almost every release, including changes that
don't touch the client↔server contract. Online play needs a way to know when a
tab has gone *incompatible* with the live backend (the op surface, the redacted
state shape, or seat-token semantics changed), which is far rarer than a release.
Tying that signal to `APP_VERSION` would false-positive constantly.

## Decision

`src/game/version.ts` exports a second, independent integer `PROTOCOL_VERSION`,
bumped **by hand** and only on a breaking wire change. Every request carries the
client's `PROTOCOL_VERSION`; if it's present and doesn't match the server's, the
server replies `426` and the client shows a "refresh to update" prompt instead of
misparsing a changed response shape. `version`/`health` are exempt so a client can
always discover the mismatch. A missing field is allowed (older/manual callers),
so the check is backward compatible.

## Consequences

- Deploys go backend-first (a bumped backend can still serve older clients until
  they refresh; a bumped client must never talk to an older backend). Because of
  this ordering, a bump makes in-flight tabs start getting `426` — so the client
  must treat `426` as terminal and prompt a refresh, not retry forever. (See the
  `outdated` handling in `networkTransport.ts` / `OnlineGame.tsx`.)
- Bumping `PROTOCOL_VERSION` requires rebuilding the edge bundle (`engine.mjs`).
- The judgment call — "is this change a wire break?" — is a manual gate. When
  unsure, ask before committing rather than risk silently breaking live games.
