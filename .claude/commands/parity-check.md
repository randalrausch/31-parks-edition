---
description: Audit the two boards and two backend adapters for drift (delegates to the parity-auditor agent).
argument-hint: [optional: path or "diff" to scope the audit]
---

Audit this repo's parity contracts using the **parity-auditor** agent.

Scope: ${ARGUMENTS:-the current uncommitted changes plus anything they touch}. If
no scope is given, base the audit on `git diff` against the default branch; if the
tree is clean, audit the four parity pairs across the whole repo.

Launch the `parity-auditor` subagent (via the Agent tool) with that scope and
have it check all four contracts: the two front-end boards, the two store
adapters, the rate-limiter adapters + entry shims, and edge-bundle freshness /
game-option plumbing. Relay its findings grouped by contract, each with both
`file:line` references and the specific reconciling edit. If it reports a
contract clean, say so — a trustworthy "no drift" is a valid, useful result.
