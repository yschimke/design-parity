import { describe, it, expect } from "vitest";

import { parseArgs } from "../src/cli/import-cli.js";
import { parseArgs as parseRunArgs } from "../src/cli/run.js";

describe("import CLI arguments", () => {
  it("defaults to a full, in-place, vector import of the whole map", () => {
    const args = parseArgs(["import", "--cache", "reference-cache"]);
    expect(args).toMatchObject({
      cacheDir: "reference-cache",
      max: 0,
      force: false,
      prune: false,
      format: "svg",
      contentsOnly: true,
    });
    expect(args.scale).toBeUndefined();
  });

  it("reads the ceiling, the override, and the image options", () => {
    const args = parseArgs([
      "import",
      "--cache", "rc",
      "--max", "25",
      "--force",
      "--prune",
      "--format", "png",
      "--scale", "2",
      "--contents-only", "false",
    ]);
    expect(args).toMatchObject({
      max: 25,
      force: true,
      prune: true,
      format: "png",
      scale: 2,
      contentsOnly: false,
    });
  });

  it("ignores a format it cannot render rather than importing nonsense", () => {
    expect(parseArgs(["import", "--cache", "rc", "--format", "jpeg"]).format).toBe("svg");
  });

  it("treats an unparseable --max as no ceiling", () => {
    expect(parseArgs(["import", "--cache", "rc", "--max", "lots"]).max).toBe(0);
  });
});

describe("run CLI reference-cache flags", () => {
  it("is off by default — a run with no cache behaves exactly as before", () => {
    const args = parseRunArgs(["run", "--components", "a/A.kt#A"]);
    expect(args.referenceCache).toBeUndefined();
    expect(args.referenceCacheOnly).toBe(false);
  });

  it("reads the cache directory and the no-fallback switch", () => {
    const args = parseRunArgs([
      "run",
      "--components", "a/A.kt#A",
      "--reference-cache", "reference-cache",
      "--reference-cache-only",
    ]);
    expect(args.referenceCache).toBe("reference-cache");
    expect(args.referenceCacheOnly).toBe(true);
  });

  it("does not mistake the cache path for a component handle", () => {
    const args = parseRunArgs(["run", "--reference-cache", "rc", "a/A.kt#A"]);
    expect(args.components).toEqual(["a/A.kt#A"]);
  });
});
