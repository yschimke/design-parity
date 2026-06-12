import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  loadParityConfig,
  loadParityConfigOrDefault,
  validateParityConfig,
  parityConfigSchema,
  defaultParityConfig,
  DEFAULT_DIRECTION,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

let tmp: string;
const write = async (name: string, body: string) => {
  const path = join(tmp, name);
  await writeFile(path, body, "utf8");
  return path;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parity-config-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("parity-config schema", () => {
  it("exposes a draft-07 schema", () => {
    expect(parityConfigSchema.$schema).toContain("draft-07");
  });

  it("accepts each direction value", () => {
    for (const direction of ["auto", "design-led", "code-led"]) {
      expect(validateParityConfig({ direction }).valid).toBe(true);
    }
  });

  it("accepts an empty object (direction is optional)", () => {
    expect(validateParityConfig({}).valid).toBe(true);
  });

  it("rejects an unknown direction", () => {
    const r = validateParityConfig({ direction: "design-first" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/direction/);
  });

  it("rejects extra top-level keys", () => {
    expect(validateParityConfig({ direction: "auto", extra: true }).valid).toBe(
      false,
    );
  });
});

describe("loadParityConfig", () => {
  it("loads and validates the example config", async () => {
    const config = await loadParityConfig(fixture("examples/design-parity.json"));
    expect(config.direction).toBe("code-led");
  });

  it("normalizes a present file with no direction to the auto default", async () => {
    const path = await write("no-direction.json", "{}");
    const config = await loadParityConfig(path);
    expect(config.direction).toBe("auto");
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadParityConfig(fixture("nope.json"))).rejects.toThrow(
      /cannot read/,
    );
  });

  it("throws a readable error for an invalid config", async () => {
    const path = await write("bad.json", '{ "direction": "sketch-led" }');
    await expect(loadParityConfig(path)).rejects.toThrow(
      /failed schema validation/,
    );
  });

  it("throws a readable error for non-JSON", async () => {
    const path = await write("notjson.json", "direction: auto");
    await expect(loadParityConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe("loadParityConfigOrDefault", () => {
  it("defaults a missing config to auto", async () => {
    const config = await loadParityConfigOrDefault(fixture("nope.json"));
    expect(config).toEqual(defaultParityConfig());
    expect(config.direction).toBe(DEFAULT_DIRECTION);
    expect(DEFAULT_DIRECTION).toBe("auto");
  });

  it("still throws on a present-but-invalid config", async () => {
    const path = await write("bad2.json", '{ "direction": 7 }');
    await expect(loadParityConfigOrDefault(path)).rejects.toThrow(
      /failed schema validation/,
    );
  });
});
