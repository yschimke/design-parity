import { describe, expect, it } from "vitest";

import type { Image, SemanticTree } from "@design-parity/core";

import { buildCatalog, buildComponent } from "../src/ingest.js";
import type { ComponentSource } from "../src/ingest.js";

const ideal: Image[] = [{ state: "default", uri: "a.png", width: 10, height: 10 }];

describe("buildComponent", () => {
  it("throws when there are no ideal images", () => {
    expect(() => buildComponent({ componentId: "X", ideal: [] })).toThrow(/no ideal images/);
  });

  it("computes greenlines from findings + semantics and keeps both variants", () => {
    const semantics: SemanticTree = {
      root: { children: [{ role: "button", label: "Go", bounds: { x: 0, y: 0, width: 80, height: 48 } }] },
    };
    const source: ComponentSource = {
      componentId: "Button/Filled",
      group: "Buttons",
      ideal,
      layout: [{ state: "default", uri: "w.png", width: 10, height: 10 }],
      semantics,
      findings: [{ kind: "contrast", severity: "error", message: "low contrast" }],
    };
    const c = buildComponent(source);
    expect(c.variants.layout).toHaveLength(1);
    expect(c.greenlines[0]?.severity).toBe("error");
    expect(c.greenlines[1]?.detail?.["role"]).toBe("button");
    expect(c.semantics).toBe(semantics);
    // A wireframe SVG is generated ahead of time from the bounded semantics.
    expect(c.wireframeSvg).toContain("<svg");
    expect(c.wireframeSvg).toContain("<rect ");
  });

  it("omits the layout variant when none is supplied", () => {
    expect(buildComponent({ componentId: "X", ideal }).variants.layout).toBeUndefined();
  });
});

describe("buildCatalog", () => {
  const meta = { system: "compose-m3", title: "Compose Material 3" };

  it("lifts themeTokens from component semantics when not given explicitly", () => {
    const sources: ComponentSource[] = [
      { componentId: "A", ideal },
      {
        componentId: "B",
        ideal,
        semantics: { root: {}, themeTokens: { colors: { primary: "#123456" } } },
      },
    ];
    const catalog = buildCatalog(meta, sources);
    expect(catalog.themeTokens).toEqual({ colors: { primary: "#123456" } });
    expect(catalog.components).toHaveLength(2);
  });

  it("prefers an explicit themeTokens set", () => {
    const explicit = { colors: { primary: "#abcdef" } };
    const catalog = buildCatalog(meta, [{ componentId: "A", ideal }], explicit);
    expect(catalog.themeTokens).toBe(explicit);
  });

  it("leaves themeTokens unset when nothing supplies them", () => {
    expect(buildCatalog(meta, [{ componentId: "A", ideal }]).themeTokens).toBeUndefined();
  });
});
