import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  loadChecksConfig,
  loadChecksConfigOrDefault,
  validateChecksConfig,
  checksConfigSchema,
  defaultChecksConfig,
  resolveConfig,
  runChecks,
  type ChecksConfig,
} from "../src/index.js";
import { goldenCandidate, goldenFigmaReference } from "./helpers.js";

const run = promisify(execFile);

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);
const here = fileURLToPath(new URL(".", import.meta.url));
const local = (p: string) => resolve(here, p);
const cli = fileURLToPath(
  new URL("../dist/cli/validate-checks.js", import.meta.url),
);

/**
 * The exact object `@design-parity/baseline` writes for
 * `design-parity.checks.json` (see packages/baseline/src/checks.ts —
 * `defaultCheckConfig`). Reproduced here, not imported, to avoid a circular
 * dependency (baseline depends on checks). The point of issue #25 is that these
 * field names match `ChecksConfig`; this keeps that contract pinned.
 */
const baselineGeneratedConfig = {
  contrastLevel: "AA",
  flagHardcodedStrings: true,
};

let tmp: string;
const write = async (name: string, body: string) => {
  const path = join(tmp, name);
  await writeFile(path, body, "utf8");
  return path;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "checks-config-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("checks-config schema", () => {
  it("exposes a draft-07 schema", () => {
    expect(checksConfigSchema.$schema).toContain("draft-07");
  });

  it("accepts an empty object (all knobs optional)", () => {
    expect(validateChecksConfig({}).valid).toBe(true);
  });

  it("accepts a fully-populated config", () => {
    const cfg = {
      contrastLevel: "AAA",
      minTouchTarget: 44,
      glyphAdvance: 0.5,
      themes: ["light", "dark"],
      flagHardcodedStrings: false,
    };
    expect(validateChecksConfig(cfg).valid).toBe(true);
  });

  it("accepts a $schema self-reference", () => {
    expect(
      validateChecksConfig({ $schema: "../schema.json", contrastLevel: "AA" })
        .valid,
    ).toBe(true);
  });

  it("rejects an unknown contrast level", () => {
    const r = validateChecksConfig({ contrastLevel: "AAAA" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/contrastLevel/);
  });

  it("rejects unknown top-level keys", () => {
    expect(validateChecksConfig({ unknownKnob: true }).valid).toBe(false);
  });

  it("rejects an unknown theme", () => {
    expect(validateChecksConfig({ themes: ["sepia"] }).valid).toBe(false);
  });
});

describe("baseline's generated config (issue #25 acceptance)", () => {
  it("validates against the schema", () => {
    expect(validateChecksConfig(baselineGeneratedConfig).valid).toBe(true);
  });

  it("loads into a ChecksConfig and runChecks accepts it", async () => {
    const path = await write(
      "design-parity.checks.json",
      JSON.stringify(baselineGeneratedConfig, null, 2),
    );
    const config: ChecksConfig = await loadChecksConfig(path);
    expect(config.contrastLevel).toBe("AA");
    expect(config.flagHardcodedStrings).toBe(true);

    const resolved = resolveConfig(config);
    expect(resolved.flagHardcodedStrings).toBe(true);

    // runChecks must accept the loaded config without throwing.
    const findings = runChecks(goldenFigmaReference(), goldenCandidate(), config);
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe("loadChecksConfig", () => {
  it("loads and validates the example config", async () => {
    const config = await loadChecksConfig(
      fixture("examples/design-parity.checks.json"),
    );
    expect(config.contrastLevel).toBe("AA");
    expect(config.minTouchTarget).toBe(48);
    // The $schema self-reference is stripped, not surfaced on the config.
    expect((config as Record<string, unknown>).$schema).toBeUndefined();
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadChecksConfig(fixture("nope.json"))).rejects.toThrow(
      /cannot read/,
    );
  });

  it("throws a readable error for an invalid config", async () => {
    await expect(
      loadChecksConfig(local("fixtures/invalid-checks-config.json")),
    ).rejects.toThrow(/failed schema validation/);
  });

  it("throws a readable error for non-JSON", async () => {
    const path = await write("notjson.json", "contrastLevel: AA");
    await expect(loadChecksConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe("loadChecksConfigOrDefault", () => {
  it("defaults a missing config to the committed defaults", async () => {
    const config = await loadChecksConfigOrDefault(fixture("nope.json"));
    expect(config).toEqual(defaultChecksConfig());
    // Empty defaults resolve to the engine's committed thresholds.
    const resolved = resolveConfig(config);
    expect(resolved.contrastLevel).toBe("AA");
    expect(resolved.flagHardcodedStrings).toBe(false);
  });

  it("still throws on a present-but-invalid config", async () => {
    const path = await write("bad.json", '{ "contrastLevel": 7 }');
    await expect(loadChecksConfigOrDefault(path)).rejects.toThrow(
      /failed schema validation/,
    );
  });
});

describe("design-parity-validate-checks CLI", () => {
  it("exits zero for the valid example", async () => {
    const { stdout } = await run("node", [
      cli,
      fixture("examples/design-parity.checks.json"),
    ]);
    expect(stdout).toMatch(/^ok /m);
  });

  it("exits non-zero with a readable error for an invalid file", async () => {
    await expect(
      run("node", [cli, local("fixtures/invalid-checks-config.json")]),
    ).rejects.toMatchObject({ code: 1 });
  });
});
