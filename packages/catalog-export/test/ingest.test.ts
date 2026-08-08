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

  it("carries both kit handles, and omits an absent referenceSet", () => {
    // `reference` is the one node a parity run diffs against; `referenceSet` is the family a
    // screen's sibling variant matches through. buildComponent copies field by field, so a new
    // field reaches the published catalog only by being named here — an omission is silent.
    const c = buildComponent({
      componentId: "Lists/ListItem",
      ideal,
      reference: { source: "figma", ref: "figma:AbCdEf/51964:64241" },
      referenceSet: "figma:AbCdEf/51964:63037",
    });
    expect(c.reference?.ref).toBe("figma:AbCdEf/51964:64241");
    expect(c.referenceSet).toBe("figma:AbCdEf/51964:63037");

    // Optional: a component naming only the variant is shaped exactly as before.
    expect(buildComponent({ componentId: "X", ideal }).referenceSet).toBeUndefined();
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
