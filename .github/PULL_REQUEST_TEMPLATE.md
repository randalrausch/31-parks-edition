## What & why

Describe the change and the reason for it.

## How I verified

Run the same gate CI runs (see [CONTRIBUTING.md](../CONTRIBUTING.md#before-you-open-a-pr)):

- [ ] `npm run format:check` (run `npm run format` to fix)
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (real-browser Playwright — CI runs this too)
- [ ] Manually tested (describe)

<!-- If you touched src/game/ (the shared engine), CI rejects a stale bundle: -->
- [ ] If I changed `src/game/`: I ran `npm run build:edge` and committed `supabase/functions/_shared/engine.mjs`
<!-- Parity: this game has two boards and two backend adapters that must not drift. -->
- [ ] If I changed a board or a store adapter: I updated (or verified) its sibling

> **PR title must be a [Conventional Commit](https://www.conventionalcommits.org/)** —
> this repo squash-merges, so the title becomes the commit and drives the release.

## Notes

Anything reviewers should know (screenshots for UI/theme changes are very
welcome).
