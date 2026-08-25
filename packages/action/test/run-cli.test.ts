import { describe, it, expect } from "vitest";

import { parseArgs, indexOptions } from "../src/cli/run.js";

describe("run CLI landing-page index flags", () => {
  it("wires --repo-slug/--branch/--source-commit/--bundle-image into the index", () => {
    const args = parseArgs([
      "run",
      "--components", "ui/Button.kt#PrimaryButton",
      "--repo-slug", "owner/repo",
      "--branch", "design-parity/main",
      "--source-commit", "abc123",
      "--bundle-image", "candidates.bundle.png",
    ]);
    expect(indexOptions(args)).toEqual({
      repoSlug: "owner/repo",
      branch: "design-parity/main",
      sourceCommit: "abc123",
      bundleImage: "candidates.bundle.png",
    });
  });

  it("returns undefined when no index flags are set (relative-link fallback)", () => {
    const args = parseArgs(["run", "--components", "ui/Button.kt#PrimaryButton"]);
    expect(indexOptions(args)).toBeUndefined();
  });

  it("accepts an evidence output and verification URL for resolution", () => {
    const args = parseArgs([
      "run",
      "--components", "ui/Button.kt#PrimaryButton",
      "--acceptance-evidence", "out/acceptances.json",
      "--verification-url", "https://github.com/owner/repo/pull/12",
      "--issue-index", "out/issues.json",
    ]);
    expect(args.acceptanceEvidencePath).toBe("out/acceptances.json");
    expect(args.verificationUrl).toBe("https://github.com/owner/repo/pull/12");
    expect(args.issueIndexPath).toBe("out/issues.json");
  });
});
