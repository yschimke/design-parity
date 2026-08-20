import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveRunConfig } from "../src/index.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "design-parity-runconfig-"));
});
afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const writeParityConfig = (body: unknown) =>
  writeFile(join(repoRoot, ".design-parity.json"), JSON.stringify(body), "utf8");

describe("resolveRunConfig token policy (#367 / #368)", () => {
  it("carries the committed token knobs through as diff overrides", async () => {
    await writeParityConfig({
      direction: "design-led",
      tokens: { missingNumerics: "strict", textDerivedInsets: "measure" },
    });
    const { diffConfig } = await resolveRunConfig(repoRoot);
    expect(diffConfig).toEqual({
      missingNumerics: "strict",
      textDerivedInsets: "measure",
    });
  });

  it("carries only the knob the repo set", async () => {
    await writeParityConfig({ direction: "design-led", tokens: { missingNumerics: "strict" } });
    const { diffConfig } = await resolveRunConfig(repoRoot);
    expect(diffConfig).toEqual({ missingNumerics: "strict" });
  });

  it("leaves diffConfig absent when the repo says nothing", async () => {
    // An empty override would still be an override — the engine's committed
    // defaults have to be what a silent repo runs (Principle 1).
    await writeParityConfig({ direction: "design-led" });
    const config = await resolveRunConfig(repoRoot);
    expect(config.direction).toBe("design-led");
    expect("diffConfig" in config).toBe(false);
  });

  it("leaves diffConfig absent when there is no config file at all", async () => {
    const config = await resolveRunConfig(repoRoot);
    expect("diffConfig" in config).toBe(false);
  });
});
