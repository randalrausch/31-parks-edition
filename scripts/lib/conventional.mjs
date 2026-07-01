/**
 * Pure Conventional-Commits → semver logic for the release workflow. No git, no
 * filesystem — just data in, decision out — so it's unit-testable.
 *
 * Bump rules (breaking > feat > fix/perf):
 *   - a breaking change (`type!:` or a `BREAKING CHANGE:` body) → major
 *   - `feat:`                                                    → minor
 *   - `fix:` / `perf:`                                           → patch
 *   - only chore/docs/refactor/style/test/build/ci/revert        → no release
 *
 * Pre-1.0 rule: while the major version is 0, a breaking change bumps the MINOR
 * (0.2.0 → 0.3.0) rather than jumping to 1.0.0 — reaching 1.0 stays a deliberate,
 * human act (tag it by hand).
 *
 * "Ambiguous": commits exist, none give a releasing signal, and at least one
 * isn't a recognizable Conventional Commit — the workflow can't safely pick a
 * bump, so it asks a human instead of guessing.
 */

const SUBJECT_RE = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/;
const RELEASING = { feat: "minor", fix: "patch", perf: "patch" };

export function parseVersion(v) {
  const m = String(v)
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : { major: 0, minor: 0, patch: 0 };
}

/** Next version string for a bump, applying the pre-1.0 breaking→minor rule. */
export function nextVersion(current, bump) {
  const p = parseVersion(current);
  if (bump === "major") {
    return p.major === 0 ? `0.${p.minor + 1}.0` : `${p.major + 1}.0.0`;
  }
  if (bump === "minor") return `${p.major}.${p.minor + 1}.0`;
  if (bump === "patch") return `${p.major}.${p.minor}.${p.patch + 1}`;
  return current;
}

/** Classify one commit. `{ type: null }` = not a Conventional Commit. */
export function classify(commit) {
  const m = String(commit.subject ?? "").match(SUBJECT_RE);
  if (!m) return { type: null, subject: commit.subject ?? "" };
  const type = m[1].toLowerCase();
  const breaking = !!m[2] || /(^|\n)BREAKING[ -]CHANGE:/.test(commit.body ?? "");
  return { type, breaking, desc: m[3].trim() };
}

/**
 * Decide a release from the commits since the last tag.
 * Returns { bump, releasable, ambiguous, nextVersion, sections, unclassified }.
 */
export function decideRelease(commits, currentVersion) {
  const sections = { breaking: [], feat: [], fix: [], perf: [] };
  const unclassified = [];
  let hasBreaking = false;
  let hasFeat = false;
  let hasPatch = false;

  for (const raw of commits) {
    const c = classify(raw);
    if (c.type === null) {
      unclassified.push(c.subject);
      continue;
    }
    if (c.breaking) {
      hasBreaking = true;
      sections.breaking.push(c.desc);
    }
    if (c.type === "feat") {
      hasFeat = true;
      sections.feat.push(c.desc);
    } else if (c.type === "fix") {
      hasPatch = true;
      sections.fix.push(c.desc);
    } else if (c.type === "perf") {
      hasPatch = true;
      sections.perf.push(c.desc);
    }
  }

  const bump = hasBreaking ? "major" : hasFeat ? "minor" : hasPatch ? "patch" : null;
  const releasable = bump !== null;
  // Only prompt a human when there's *no* clear signal AND something couldn't be
  // parsed — a clean run of only chore/docs commits is an unambiguous "no release".
  const ambiguous = !releasable && unclassified.length > 0;

  return {
    bump,
    releasable,
    ambiguous,
    nextVersion: releasable ? nextVersion(currentVersion, bump) : null,
    sections,
    unclassified,
  };
}

/** Render a Markdown changelog section for a decided release. */
export function renderChangelog(version, dateIso, decision) {
  const day = dateIso.slice(0, 10);
  const out = [`## v${version} — ${day}`, ""];
  const block = (title, items) => {
    if (!items.length) return;
    out.push(`### ${title}`, "");
    for (const it of items) out.push(`- ${it}`);
    out.push("");
  };
  block("⚠ Breaking changes", decision.sections.breaking);
  block("Features", decision.sections.feat);
  block("Fixes", [...decision.sections.fix, ...decision.sections.perf]);
  return out.join("\n").trimEnd() + "\n";
}
