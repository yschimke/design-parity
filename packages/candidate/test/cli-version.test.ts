import { describe, expect, it } from "vitest";

import {
  MINIMUM_COMPOSE_PREVIEW_VERSION,
  SpawnComposePreviewCli,
  UnsupportedComposePreviewVersionError,
  compareCliVersions,
  isBelowMinimum,
  parseCliVersion,
  parseShow,
} from "../src/index.js";
import type { CommandRunner, RunResult } from "../src/exec.js";

/** A runner whose `--version` answers with [stdout]; anything else is unused. */
function versionRunner(stdout: string, code = 0): CommandRunner {
  return {
    async run(_command, args): Promise<RunResult> {
      if (args[0] === "--version") return { code, stdout, stderr: "" };
      throw new Error("unexpected invocation");
    },
  };
}

describe("parseCliVersion", () => {
  it("reads the CLI's actual output shape", () => {
    // `Main.kt` prints exactly this: `compose-preview $BUNDLE_VERSION`.
    expect(parseCliVersion("compose-preview 0.19.50")).toMatchObject({
      major: 0,
      minor: 19,
      patch: 50,
      raw: "0.19.50",
    });
  });

  it("keeps a -SNAPSHOT build's release numbers", () => {
    expect(parseCliVersion("compose-preview 0.19.50-SNAPSHOT")).toMatchObject({
      minor: 19,
      patch: 50,
      raw: "0.19.50-SNAPSHOT",
    });
  });

  it("tolerates extra output around the version", () => {
    const noisy = "some banner\ncompose-preview 1.2.3\nmore trailing output\n";
    expect(parseCliVersion(noisy)?.raw).toBe("1.2.3");
  });

  it("returns null when there is no version to find", () => {
    expect(parseCliVersion("compose-preview (dev build)")).toBeNull();
  });
});

describe("compareCliVersions", () => {
  const v = (s: string) => parseCliVersion(s)!;

  it("orders by major, then minor, then patch", () => {
    expect(compareCliVersions(v("1.0.0"), v("0.99.99"))).toBeGreaterThan(0);
    expect(compareCliVersions(v("0.15.2"), v("0.15.10"))).toBeLessThan(0);
    expect(compareCliVersions(v("0.15.2"), v("0.15.2"))).toBe(0);
  });

  it("compares 10 as newer than 9 rather than lexically", () => {
    // The bug a string compare would have: "0.9.0" > "0.10.0" alphabetically.
    expect(compareCliVersions(v("0.10.0"), v("0.9.0"))).toBeGreaterThan(0);
  });
});

describe("isBelowMinimum", () => {
  const v = (s: string) => parseCliVersion(s)!;

  it("rejects a version below the floor", () => {
    expect(isBelowMinimum(v("0.13.9"), "0.14.0")).toBe(true);
  });

  it("accepts the floor itself and anything newer", () => {
    expect(isBelowMinimum(v("0.14.0"), "0.14.0")).toBe(false);
    expect(isBelowMinimum(v("0.19.50"), "0.14.0")).toBe(false);
  });

  it("accepts a -SNAPSHOT of the floor", () => {
    // Built from source at or ahead of the release it is named for; blocking it
    // would lock out anyone developing against a local compose-ai-tools tree.
    expect(isBelowMinimum(v("0.14.0-SNAPSHOT"), "0.14.0")).toBe(false);
  });

  it("accepts the version the existing test suite pins", () => {
    // test/candidate.test.ts's fake reports 0.14.0. That is the only in-repo
    // evidence of a version this package runs against, and it is where
    // MINIMUM_COMPOSE_PREVIEW_VERSION comes from — so the default floor must
    // never reject it. If this fails, the floor was raised without evidence.
    expect(isBelowMinimum(v("0.14.0"))).toBe(false);
  });
});

describe("SpawnComposePreviewCli.ensureInstalled version gate", () => {
  it("rejects a CLI older than the supported minimum", async () => {
    const cli = new SpawnComposePreviewCli({
      projectDir: ".",
      runner: versionRunner("compose-preview 0.9.0"),
    });
    await expect(cli.ensureInstalled()).rejects.toBeInstanceOf(
      UnsupportedComposePreviewVersionError,
    );
    // The message has to name both versions — the whole point is that the old
    // failure mode ("invalid JSON") told the user nothing about what to fix.
    await expect(cli.ensureInstalled()).rejects.toThrow(/0\.9\.0/);
    await expect(cli.ensureInstalled()).rejects.toThrow(
      new RegExp(MINIMUM_COMPOSE_PREVIEW_VERSION.replace(/\./g, "\\.")),
    );
  });

  it("accepts a supported CLI and records the version for diagnostics", async () => {
    const cli = new SpawnComposePreviewCli({
      projectDir: ".",
      runner: versionRunner("compose-preview 0.19.50"),
    });
    await cli.ensureInstalled();
    expect(cli.version?.raw).toBe("0.19.50");
  });

  it("proceeds when the version cannot be parsed", async () => {
    // A locally built or wrapped binary. Refusing to run on something we merely
    // failed to parse would turn a cosmetic upstream output change into an
    // outage here, so unknown means proceed.
    const cli = new SpawnComposePreviewCli({
      projectDir: ".",
      runner: versionRunner("compose-preview (dev build)"),
    });
    await expect(cli.ensureInstalled()).resolves.toBeUndefined();
    expect(cli.version).toBeNull();
  });
});

describe("parseShow version attribution", () => {
  it("names the CLI version in an invalid-JSON failure", () => {
    // The failure this guard exists for. `show --json`'s shape is owned by the
    // CLI, so a skew lands here — and "invalid JSON" on its own reads as a bug
    // in this package rather than an out-of-date toolchain.
    expect(() => parseShow("not json at all", "0.12.0")).toThrow(/0\.12\.0/);
    expect(() => parseShow("not json at all", "0.12.0")).toThrow(
      /version skew/i,
    );
  });

  it("still explains itself when the version is unknown", () => {
    expect(() => parseShow("not json at all")).toThrow(
      /compose-preview --version/,
    );
  });
});
