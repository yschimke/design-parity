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

  it("keys exact token acceptances by component and source", async () => {
    const accepted = {
      component: "ui/Checkbox.kt#Checkbox",
      source: "figma",
      token: "spacing.padding",
      expected: 4,
      actual: 2,
      issue: "https://github.com/example/repo/issues/1",
    };
    await writeParityConfig({
      direction: "design-led",
      tokens: { acceptedDifferences: [accepted] },
    });
    const config = await resolveRunConfig(repoRoot);
    expect(config.acceptedTokenDifferences?.get("ui/Checkbox.kt#Checkbox figma")).toEqual([
      accepted,
    ]);
  });
});

describe("resolveRunConfig known differences (#3808)", () => {
  it("keys exact scopes by component and source", async () => {
    const scope = {
      system: "m3",
      component: "IconButton/Tonal",
      previewId: "preview",
      referenceId: "reference",
      variant: "ideal/default/light",
      overrides: {},
    };
    await writeFile(join(repoRoot, "design-map.json"), JSON.stringify({
      components: [
        {
          code: "ui/Icon.kt#Tonal",
          source: "figma",
          ref: "figma:K/1:2",
          knownDifferences: { "default/light": scope },
        },
        {
          code: "ui/Card.kt#Elevated",
          source: "figma",
          ref: "figma:K/1:3",
          knownDifferences: {
            "default/light": { ...scope, component: "Card/Elevated" },
          },
        },
      ],
    }));

    const config = await resolveRunConfig(repoRoot);
    expect(config.knownDifferences?.get("ui/Icon.kt#Tonal figma")?.scopes)
      .toEqual({ "default/light": scope });
    expect(config.knownDifferences?.get("ui/Card.kt#Elevated figma")?.scopes)
      .toEqual({
        "default/light": { ...scope, component: "Card/Elevated" },
      });
  });
});
