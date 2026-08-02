import {
  catalogFromCandidates,
  toCatalogManifest,
  type CatalogManifest,
  type CatalogSpec,
} from "@design-parity/catalog-export";
import type { CandidateRender, DesignMap } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { planMappedUpgrades, rewriteMappedNodeIds } from "../src/upgrade.js";

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "m3",
  title: "Material 3",
  components: [{
    componentId: "Button/Filled",
    images: [{
      variant: "ideal",
      path: "images/button-filled/ideal__default.png",
      previewId: "com.example.ButtonKt.FilledButton",
      state: "default",
      width: 120,
      height: 48,
    }],
    greenlines: [],
    redlines: [],
  }],
};

describe("planMappedUpgrades", () => {
  it("maps generated code handles to same-file Figma nodes and per-variant vectors", () => {
    const map: DesignMap = {
      components: [{ code: "Button#Filled", source: "figma", ref: "figma:FILE/1:2" }],
    };
    expect(planMappedUpgrades(manifest, map, "FILE", "https://cdn/catalog").jobs).toEqual([{
      componentId: "Button/Filled",
      nodeId: "1:2",
      cells: [{
        path: "images/button-filled/ideal__default.png",
        url: "https://cdn/catalog/images/button-filled/ideal__default.png",
        vectorUrl: "https://cdn/catalog/figma/button-filled/ideal__default.svg",
        name: "state=default",
        width: 120,
        height: 48,
      }],
    }]);
  });

  it("prefers an explicit previewId and reports unsafe/unknown mappings", () => {
    const map: DesignMap = { components: [
      { code: "src.kt#Different", previewId: "com.example.ButtonKt.FilledButton", source: "figma", ref: "figma:FILE/1:2" },
      { code: "Other#Other", source: "figma", ref: "figma:OTHER/2:3" },
      { code: "Button#Filled", source: "stitch", ref: "stitch:x" },
    ] };
    const plan = planMappedUpgrades(manifest, map, "FILE", "");
    expect(plan.jobs.map((job) => job.nodeId)).toEqual(["1:2"]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual([
      "mapping points to a different Figma file",
      "not a Figma mapping",
    ]);
  });

  it("resolves a variant-tagged preview list only when one component owns every preview", () => {
    const themed: CatalogManifest = {
      ...manifest,
      components: [{
        ...manifest.components[0]!,
        images: [
          { ...manifest.components[0]!.images[0]!, previewId: "app.ButtonKt.Light", theme: "light" },
          { ...manifest.components[0]!.images[0]!, previewId: "app.ButtonKt.Dark", theme: "dark" },
        ],
      }],
    };
    const map: DesignMap = { components: [{
      code: "real/Button.kt#Primary",
      source: "figma",
      ref: "figma:FILE/1:2",
      previewId: [
        { previewId: "app.ButtonKt.Light", theme: "light" },
        { previewId: "app.ButtonKt.Dark", theme: "dark" },
      ],
    }] };
    expect(planMappedUpgrades(themed, map, "FILE", "").jobs[0]?.componentId).toBe("Button/Filled");
  });

  it("does not fall back to a code-name match when an explicit previewId is stale", () => {
    const map: DesignMap = { components: [{
      code: "Button#Filled",
      source: "figma",
      ref: "figma:FILE/1:2",
      previewId: "missing.Preview",
    }] };
    const plan = planMappedUpgrades(manifest, map, "FILE", "");
    expect(plan.jobs).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("no matching catalog component or previewId");
  });
});

describe("rewriteMappedNodeIds", () => {
  it("updates scalar and tagged refs while preserving unrelated entries", () => {
    const map: DesignMap = { components: [
      { code: "A#A", source: "figma", ref: "figma:FILE/1:2" },
      { code: "B#B", source: "figma", ref: [
        { ref: "figma:FILE/2:3", state: "default" },
        { ref: "figma:OTHER/4:5", state: "pressed" },
      ] },
    ] };
    expect(rewriteMappedNodeIds(map, "FILE", { "1:2": "9:1", "2:3": "9:2" })).toEqual({
      components: [
        { code: "A#A", source: "figma", ref: "figma:FILE/9:1" },
        { code: "B#B", source: "figma", ref: [
          { ref: "figma:FILE/9:2", state: "default" },
          { ref: "figma:OTHER/4:5", state: "pressed" },
        ] },
      ],
    });
  });
});

describe("candidate catalog → design-map upgrade", () => {
  it("retains multipreview ids through catalog.json and resolves a real code mapping", () => {
    const candidate = (theme: "light" | "dark"): CandidateRender => ({
      componentId: `app.ButtonKt.Filled_${theme}`,
      previewId: `app.ButtonKt.Filled_${theme}`,
      functionName: "Filled",
      images: [{ state: "default", theme, uri: `${theme}.png`, width: 120, height: 48 }],
      semantics: { theme, root: {} },
    });
    const spec: CatalogSpec = {
      system: "m3",
      title: "Material 3",
      groups: [{ name: "Buttons", components: [{ componentId: "Button/Filled", preview: "Filled" }] }],
    };
    const { catalog } = catalogFromCandidates([candidate("light"), candidate("dark")], spec);
    const generated = toCatalogManifest(catalog);
    const map: DesignMap = { components: [{
      code: "src/main/Button.kt#PrimaryButton",
      source: "figma",
      ref: "figma:FILE/7:9",
      previewId: [
        { previewId: "app.ButtonKt.Filled_light", theme: "light" },
        { previewId: "app.ButtonKt.Filled_dark", theme: "dark" },
      ],
    }] };

    const plan = planMappedUpgrades(generated, map, "FILE", "https://cdn/m3");
    expect(plan.skipped).toEqual([]);
    expect(plan.jobs[0]).toMatchObject({
      componentId: "Button/Filled",
      nodeId: "7:9",
      cells: [
        { name: "state=default, theme=light" },
        { name: "state=default, theme=dark" },
      ],
    });
  });
});
