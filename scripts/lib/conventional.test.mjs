import { describe, it, expect } from "vitest";
import {
  parseVersion,
  nextVersion,
  classify,
  decideRelease,
  renderChangelog,
  compareVersions,
} from "./conventional.mjs";

const commit = (subject, body = "") => ({ subject, body });

describe("nextVersion", () => {
  it("bumps patch/minor normally", () => {
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  });
  it("keeps a breaking change in 0.x as a minor bump (no accidental 1.0)", () => {
    expect(nextVersion("0.2.0", "major")).toBe("0.3.0");
    expect(nextVersion("0.2.5", "minor")).toBe("0.3.0");
  });
  it("parses a leading v and missing parts", () => {
    expect(parseVersion("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
  });
});

describe("compareVersions (release-tag integrity guard)", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("0.3.0", "0.2.9")).toBe(1);
    expect(compareVersions("0.2.1", "0.2.2")).toBe(-1);
    expect(compareVersions("v0.4.0", "0.4.0")).toBe(0); // tolerates a leading v
  });
  it("detects a tag that fell behind APP_VERSION (the missing-tag-push bug)", () => {
    // A prior release bumped version.ts to 0.4.0 but its tag never pushed, so the
    // newest tag on the remote is still the baseline — the guard must flag it.
    expect(compareVersions("v0.2.0", "0.4.0")).toBe(-1);
    // In a healthy repo the newest tag equals APP_VERSION.
    expect(compareVersions("v0.4.0", "0.4.0")).toBe(0);
  });
});

describe("classify", () => {
  it("reads type, scope, and breaking marker", () => {
    expect(classify(commit("feat(board): add X")).type).toBe("feat");
    expect(classify(commit("fix!: drop Y")).breaking).toBe(true);
    expect(classify(commit("refactor: z", "BREAKING CHANGE: wire changed")).breaking).toBe(true);
    expect(classify(commit("nonsense line")).type).toBe(null);
  });
});

describe("decideRelease", () => {
  it("picks the highest bump present (breaking > feat > fix)", () => {
    const d = decideRelease([commit("fix: a"), commit("feat: b"), commit("feat!: c")], "0.2.0");
    expect(d.bump).toBe("major");
    expect(d.nextVersion).toBe("0.3.0"); // 0.x breaking → minor
    expect(d.releasable).toBe(true);
  });
  it("feat → minor, fix → patch", () => {
    expect(decideRelease([commit("feat: a")], "1.0.0").nextVersion).toBe("1.1.0");
    expect(decideRelease([commit("fix: a")], "1.0.0").nextVersion).toBe("1.0.1");
  });
  it("chore/docs only → no release, not ambiguous", () => {
    const d = decideRelease([commit("chore: a"), commit("docs: b")], "1.0.0");
    expect(d.releasable).toBe(false);
    expect(d.ambiguous).toBe(false);
  });
  it("unparseable commits with no releasing signal → ambiguous", () => {
    const d = decideRelease([commit("just did stuff")], "1.0.0");
    expect(d.releasable).toBe(false);
    expect(d.ambiguous).toBe(true);
    expect(d.unclassified).toEqual(["just did stuff"]);
  });
  it("a real feat alongside an unparseable commit still releases", () => {
    const d = decideRelease([commit("feat: a"), commit("oops")], "1.0.0");
    expect(d.releasable).toBe(true);
    expect(d.ambiguous).toBe(false);
  });
});

describe("renderChangelog", () => {
  it("groups breaking/features/fixes under a dated heading", () => {
    const d = decideRelease(
      [commit("feat: new park"), commit("fix: bad score"), commit("feat!: wire")],
      "0.2.0",
    );
    const md = renderChangelog(d.nextVersion, "2026-07-01T00:00:00Z", d);
    expect(md).toContain("## v0.3.0 — 2026-07-01");
    expect(md).toContain("### ⚠ Breaking changes");
    expect(md).toContain("### Features");
    expect(md).toContain("- new park");
    expect(md).toContain("### Fixes");
    expect(md).toContain("- bad score");
  });
});
