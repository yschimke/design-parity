import { describe, it, expect } from "vitest";

import { parseArgs } from "../src/cli/publish-cli.js";

describe("publish CLI args", () => {
  it("reads the staged dir, branch and message", () => {
    const args = parseArgs([
      "publish",
      "--dir",
      "out",
      "--branch",
      "design-parity/main",
      "--message",
      "design-parity artifacts for abc123",
    ]);
    expect(args).toEqual({
      dir: "out",
      branch: "design-parity/main",
      message: "design-parity artifacts for abc123",
      allowUnchanged: false,
    });
  });

  it("defaults to skipping an unchanged board", () => {
    // An identical tree is not a data point. The branch is read as a trend —
    // one commit per run that changed something — so an empty commit per run
    // would bury the ones that mean anything.
    expect(parseArgs(["publish", "--dir", "out", "--branch", "b"]).allowUnchanged).toBe(
      false,
    );
    expect(
      parseArgs(["publish", "--dir", "out", "--branch", "b", "--allow-unchanged"])
        .allowUnchanged,
    ).toBe(true);
  });

  it("rejects an unknown option rather than silently ignoring it", () => {
    // A typo'd flag that parses to a no-op would publish to the wrong branch,
    // or force-push semantics nobody asked for, without saying so.
    expect(() => parseArgs(["publish", "--force"])).toThrow(/unknown option: --force/);
  });
});
