import type { CatalogManifest } from "@design-parity/catalog-export";
import type { DesignMap } from "@design-parity/core";
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
      { code: "src.kt#Different", previewId: "Button/Filled", source: "figma", ref: "figma:FILE/1:2" },
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
