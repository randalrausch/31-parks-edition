/**
 * Release driver for CI (.github/workflows/release.yml) — and runnable locally
 * with `node scripts/release.mjs --dry` to preview.
 *
 * Reads the commits since the last tag, decides a semver bump from Conventional
 * Commits (see scripts/lib/conventional.mjs), and — when a release is warranted
 * — updates the single-source version (src/game/version.ts + package manifests),
 * prepends a CHANGELOG section, and writes release notes. It does NOT touch git
 * history or tags; the workflow commits, tags, rebuilds engine.mjs, and publishes
 * the GitHub Release. Emits a `status` for the workflow to branch on:
 *   released | none | needs-input
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { decideRelease, renderChangelog, compareVersions } from "./lib/conventional.mjs";

const DRY = process.argv.includes("--dry");
const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root).pathname;

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function setOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) appendFileSync(f, `${key}=${value}\n`);
  console.log(`[release] ${key}=${value}`);
}

/** Current version from the single source of truth. */
function currentVersion() {
  const src = readFileSync(path("src/game/version.ts"), "utf8");
  return src.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "0.0.0";
}

/** The most recent v* tag, or null if the repo has never been tagged. */
function lastTag() {
  try {
    return git("describe", "--tags", "--match", "v*", "--abbrev=0");
  } catch {
    return null;
  }
}

/** Commits since the given tag (exclusive). */
function commitsSince(tag) {
  const range = `${tag}..HEAD`;
  const RS = "\x1e";
  const US = "\x1f";
  const raw = git("log", range, "--no-merges", `--format=%H${US}%s${US}%b${RS}`);
  return (
    raw
      .split(RS)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash, subject, body] = r.split(US);
        return { hash, subject, body: body ?? "" };
      })
      // Ignore the release bot's own version-bump commits.
      .filter((c) => !/^chore\(release\):/.test(c.subject))
  );
}

function replaceInFile(file, re, replacement) {
  const p = path(file);
  if (!existsSync(p)) return;
  const before = readFileSync(p, "utf8");
  const after = before.replace(re, replacement);
  if (!DRY) writeFileSync(p, after);
}

function bumpVersionFiles(version) {
  // src/game/version.ts is the single source of truth read by the frontend and
  // both backends. The package.json `version` fields are decorative npm metadata
  // and are deliberately left alone — editing them would desync the lockfiles and
  // break `npm ci` in CI for no display benefit.
  replaceInFile("src/game/version.ts", /(APP_VERSION\s*=\s*")[^"]+(")/, `$1${version}$2`);
}

function prependChangelog(section) {
  const p = path("CHANGELOG.md");
  const header = "# Changelog\n\n";
  const existing = existsSync(p) ? readFileSync(p, "utf8") : header;
  const body = existing.startsWith("# Changelog")
    ? existing.slice(existing.indexOf("\n\n") + 2)
    : existing;
  const next = `${header}${section}\n${body}`;
  if (!DRY) writeFileSync(p, next);
}

// ── main ──────────────────────────────────────────────────────────────────────
const current = currentVersion();
const notesFile = path(".release-notes.md");
const tag = lastTag();

// First run ever: seed the current version as the baseline tag WITHOUT bumping,
// so numbering starts from the intended version (e.g. v0.2.0) instead of a bump
// computed from the whole pre-automation history. Future runs bump from here.
if (!tag) {
  if (!DRY)
    writeFileSync(notesFile, `Baseline release v${current}. Automated versioning starts here.\n`);
  setOutput("status", "baseline");
  setOutput("version", current);
  setOutput("tag", `v${current}`);
  setOutput("notes_file", notesFile);
  console.log(`[release] no tags yet — seeding baseline v${current}`);
  process.exit(0);
}

// Integrity guard: after a correct release the newest tag and APP_VERSION are the
// SAME X.Y.Z (the workflow bumps version.ts and tags the same commit). If the tag
// is BEHIND the version, a previous release bumped version.ts but never pushed its
// tag — so `git describe` is stuck in the past and `commitsSince(tag)` would
// re-count already-released history, bumping on every push (this is exactly what
// produced v0.2.2/v0.2.3 off non-releasing commits). Refuse and ask a human rather
// than guess a bogus range.
if (compareVersions(tag, current) < 0) {
  const notes = path(".release-ambiguous.md");
  if (!DRY)
    writeFileSync(
      notes,
      `Release tags are out of sync: the newest tag is \`${tag}\` but APP_VERSION is \`${current}\`.\n\n` +
        `A previous release bumped the version but its tag never reached the remote, so the ` +
        `changelog would re-count already-released commits. Fix by tagging the current release ` +
        `commit and pushing it:\n\n    git tag v${current} && git push origin v${current}\n\n` +
        `then re-run. (The workflow now pushes release tags explicitly, so this shouldn't recur.)\n`,
    );
  setOutput("status", "needs-input");
  setOutput("current", current);
  console.log(`[release] tag ${tag} is behind APP_VERSION ${current} — tags out of sync`);
  process.exit(0);
}

const commits = commitsSince(tag);
const decision = decideRelease(commits, current);

if (decision.ambiguous) {
  // Nothing releasing, but commits couldn't be parsed — ask a human.
  const list = decision.unclassified.map((s) => `- ${s}`).join("\n");
  const notes = path(".release-ambiguous.md");
  if (!DRY)
    writeFileSync(
      notes,
      `The release workflow couldn't determine a version bump — these commits since \`${current}\` aren't Conventional Commits:\n\n${list}\n\nPlease re-tag manually (\`git tag vX.Y.Z\`) or reword the commits, then re-run.\n`,
    );
  setOutput("status", "needs-input");
  setOutput("current", current);
  process.exit(0);
}

if (!decision.releasable) {
  setOutput("status", "none");
  console.log("[release] no releasable commits since", current);
  process.exit(0);
}

const version = decision.nextVersion;
const dateIso = new Date().toISOString();
const section = renderChangelog(version, dateIso, decision);

bumpVersionFiles(version);
prependChangelog(section);

if (!DRY) writeFileSync(notesFile, section);

setOutput("status", "released");
setOutput("version", version);
setOutput("tag", `v${version}`);
setOutput("bump", decision.bump);
setOutput("notes_file", notesFile);
console.log(`[release] ${current} → ${version} (${decision.bump})`);
