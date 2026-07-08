# Changelog

## v0.11.1 — 2026-07-08

### Fixes

- make the birthday banner message generic

## v0.11.0 — 2026-07-08

### Features

- greet Dan with a birthday banner on the board

## v0.10.0 — 2026-07-08

### Features

- make sound a per-client preference instead of a shared game option

## v0.9.1 — 2026-07-06

### Fixes

- make the frequent card-deal sound much quieter, give shuffle its own texture (#90)

## v0.9.0 — 2026-07-05

### Features

- let the host rename lobby seats in online games (#86)

## v0.8.1 — 2026-07-05

### Fixes

- security-review follow-ups + a bypass-capable release pipeline
- land release commits via PR instead of pushing straight to main (#84)
- focus room-code field and clarify its placeholder on join (#82)
- harden untrusted-input handling and add a defense-in-depth DB grant layer

## v0.8.0 — 2026-07-04

### Features

- version persisted state and close the remaining open-source review gaps (#66)

## v0.7.5 — 2026-07-04

### Fixes

- resolve open-source review gaps across reliability, security, parity, and docs (#60)

## v0.7.4 — 2026-07-04

### Fixes

- revoke EXECUTE on the SECURITY DEFINER RPCs from anon (#59)

All notable changes are recorded here. From v0.2.0 onward this file is
maintained automatically by the release workflow from
[Conventional Commits](https://www.conventionalcommits.org/) — see
[CONTRIBUTING.md](CONTRIBUTING.md#versioning--releases).

## v0.7.3 — 2026-07-03

### Fixes

- scale action log's recent-moves window to player count (#57)

## v0.7.2 — 2026-07-03

### Fixes

- stop three redaction tests flaking on an instant natural 31 (#56)

## v0.7.1 — 2026-07-02

### Fixes

- stop online turn replay from looping and locking out the player (#52)

## v0.7.0 — 2026-07-02

### Features

- responsive board header and phone-accessible action log (#49)

## v0.6.0 — 2026-07-02

### Features

- harden Supabase reliability — pg_cron reaper + Realtime resubscribe (#46)

## v0.5.0 — 2026-07-02

### Features

- structured per-request observability via a shared router onEvent hook (#44)

## v0.4.1 — 2026-07-01

### Fixes

- cap act writes per seat token (#41)

## v0.4.0 — 2026-07-01

### Features

- report client-side crashes off-device (#38)

## v0.3.0 — 2026-07-01

### Features

- add a health probe op (#37)

## v0.2.1 — 2026-07-01

### Fixes

- P0 security & reliability hardening (#34)

<!--
v0.2.2 and v0.2.3 were tagged by a release-automation bug that re-counted
already-released commits (fixed in #39). They shipped no changes beyond v0.2.1;
each change above is now listed once, under the version that first introduced it.
-->

## v0.2.0

Baseline for automated releases. Backend hardening, backend/parity fixes, a lint
gate, board polish, and the version/release automation itself.
