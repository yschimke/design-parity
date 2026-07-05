import type { CatalogManifest } from "@design-parity/catalog-export";
import { validateDesignMap } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildDesignMap, componentIdToCode, figmaRef } from "../src/designMap.js";
import { buildImportPlan } from "../src/plan.js";

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Filled",
      group: "Buttons",
      images: [{ variant: "ideal", path: "a.png", state: "default", width: 200, height: 72 }],
      greenlines: [],
      redlines: [],
    },
    {
      componentId: "Button/Outlined",
      group: "Buttons",
      images: [{ variant: "ideal", path: "b.png", state: "default", width: 200, height: 72 }],
      greenlines: [],
      redlines: [],
    },
  ],
};

const plan = buildImportPlan(manifest, { baseUrl: "https://x" });

describe("figmaRef", () => {
  it("formats the canonical figma:<fileKey>/<nodeId> handle", () => {
    expect(figmaRef("ABC123", "1:42")).toBe("figma:ABC123/1:42");
  });
});

describe("componentIdToCode", () => {
  it("splits the last slash segment as the symbol", () => {
    expect(componentIdToCode("Button/Filled")).toBe("Button#Filled");
    expect(componentIdToCode("a/b/Filled")).toBe("a/b#Filled");
  });

  it("repeats a slash-less id so it satisfies the file#symbol schema", () => {
    expect(componentIdToCode("Switch")).toBe("Switch#Switch");
  });
});

describe("buildDesignMap", () => {
  it("emits one figma entry per placed component and validates against core's schema", () => {
    const map = buildDesignMap(plan, {
      fileKey: "ABC123",
      nodeIds: { "Button/Filled": "1:10", "Button/Outlined": "1:20" },
    });
    expect(map.components).toEqual([
      { code: "Button#Filled", source: "figma", ref: "figma:ABC123/1:10" },
      { code: "Button#Outlined", source: "figma", ref: "figma:ABC123/1:20" },
    ]);
    const verdict = validateDesignMap(map);
    expect(verdict.valid, verdict.errors.join("; ")).toBe(true);
  });

  it("skips components with no node id (their render didn't place)", () => {
    const map = buildDesignMap(plan, {
      fileKey: "ABC123",
      nodeIds: { "Button/Filled": "1:10" },
    });
    expect(map.components.map((c) => c.code)).toEqual(["Button#Filled"]);
  });

  it("threads the file key into every ref", () => {
    const map = buildDesignMap(plan, {
      fileKey: "FILE_KEY",
      nodeIds: { "Button/Filled": "1:10" },
    });
    expect(map.components[0]!.ref).toBe("figma:FILE_KEY/1:10");
  });

  it("preserves plan (group/component) order for a deterministic file", () => {
    const map = buildDesignMap(plan, {
      fileKey: "K",
      nodeIds: { "Button/Outlined": "1:20", "Button/Filled": "1:10" },
    });
    expect(map.components.map((c) => c.code)).toEqual([
      "Button#Filled",
      "Button#Outlined",
    ]);
  });
});
