/**
 * Guard: the prebuilt CI image (.github/ci-image/Dockerfile) pins a Playwright
 * version, and the E2E job runs inside it. If someone bumps @playwright/test but
 * not the image, the baked browser drifts from the test runner — silently, until
 * something behaves oddly in CI. This check makes that drift LOUD: it fails (with
 * the exact fix) the moment the Dockerfile's pinned Playwright minor no longer
 * matches the lockfile's, so you find out at PR time, not in production.
 *
 * Runs in the `gate` job (and locally: `node scripts/check-ci-image.mjs`). Compares
 * on major.minor — a patch bump (1.61.1 → 1.61.2) is tolerated because the E2E
 * specs use the system Google Chrome channel, which isn't tied to Playwright's
 * patch; a minor/major bump (1.61 → 1.62) requires rebuilding the image.
 */
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const minor = (v) => v.split(".").slice(0, 2).join("."); // "1.61.1" -> "1.61"

// The version the app is actually tested with — the exact, resolved lockfile pin.
const lock = JSON.parse(read("package-lock.json"));
const runner = lock.packages?.["node_modules/@playwright/test"]?.version;
if (!runner) {
  console.error("check-ci-image: couldn't find @playwright/test in package-lock.json");
  process.exit(2);
}

// The version(s) baked into the image. There are two pins that must agree with
// each other and with the runner: the base image tag and the `playwright@` CLI.
const dockerfile = read(".github/ci-image/Dockerfile");
const baseTag = dockerfile.match(/playwright:v([0-9]+\.[0-9]+\.[0-9]+)-/)?.[1];
const cliPin = dockerfile.match(/playwright@([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];

const problems = [];
if (!baseTag) problems.push("couldn't read the base image tag (mcr…/playwright:vX.Y.Z-…)");
if (!cliPin) problems.push("couldn't read the `playwright@X.Y.Z` CLI pin");
if (baseTag && cliPin && baseTag !== cliPin)
  problems.push(`the two Dockerfile pins disagree: base ${baseTag} vs CLI ${cliPin}`);
if (baseTag && minor(baseTag) !== minor(runner))
  problems.push(
    `the image is built for Playwright ${baseTag} but the app is tested with ${runner}`,
  );

if (problems.length) {
  console.error("✗ CI image is out of sync with @playwright/test:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\nFix: set BOTH pins in .github/ci-image/Dockerfile to v${runner} ` +
      `(the base tag and the playwright@ line), commit, and let the "Build CI image" ` +
      `workflow republish it (it also runs weekly and on demand).`,
  );
  process.exit(1);
}

console.log(`✓ CI image Playwright pin (${baseTag}) matches @playwright/test (${runner}).`);
