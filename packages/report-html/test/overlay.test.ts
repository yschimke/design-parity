import { describe, it, expect } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import { annotationSvg } from "../src/overlay.js";

describe("annotationSvg", () => {
  it("returns empty when there's no tree or no bounded nodes", () => {
    expect(annotationSvg(undefined)).toBe("");
    expect(annotationSvg({ root: { role: "group" } })).toBe("");
  });

  it("draws a box-model layer with size, radius and padding from a node", () => {
    const tree: SemanticTree = {
      root: {
        role: "button",
        label: "Continue",
        bounds: { x: 0, y: 0, width: 160, height: 48 },
        tokens: { spacing: { padding: 12 }, radius: { corner: 8 } },
      },
    };
    const svg = annotationSvg(tree);
    // viewBox is the tree's own frame (no pixel-density maths needed).
    expect(svg).toContain('viewBox="0 0 160 48"');
    expect(svg).toContain('<g data-layer="spacing">');
    // dimension + radius + padding read out in the box-model tag.
    expect(svg).toContain("160×48 r8 p12");
    // rounded corner reflected on the border box.
    expect(svg).toMatch(/rx="8"[^>]*stroke="#7db4e8"/);
  });

  it("draws a scaled board's boxes in its own pixels but labels them in dp", () => {
    // The same button captured on a 3× board: bounds are board pixels, and the
    // tokens reached the report already divided through (see `inCodeUnits`).
    const tree: SemanticTree = {
      root: {
        role: "button",
        label: "Continue",
        bounds: { x: 0, y: 0, width: 480, height: 144 },
        tokens: { spacing: { padding: 12 }, radius: { corner: 8 } },
      },
      boundsDensity: 3,
    };
    const svg = annotationSvg(tree);
    // The viewBox and the box stay pinned to the captured raster.
    expect(svg).toContain('viewBox="0 0 480 144"');
    expect(svg).toMatch(/<rect x="0" y="0" width="480" height="144"/);
    // The tag reads out in dp — the same 160×48 r8 p12 the candidate quotes.
    expect(svg).toContain("160×48 r8 p12");
    expect(svg).not.toContain("480×144");
    // The drawn radius and padding ring are the dp tokens multiplied back into
    // the raster's space: r8 → rx 24, p12 → a 36px inset.
    expect(svg).toMatch(/rx="24"[^>]*stroke="#7db4e8"/);
    expect(svg).toContain("M36,36 H444 V108 H36 Z");
  });

  it("reads an unstated boundsDensity as a shared space, not a factor to guess", () => {
    const tree: SemanticTree = {
      root: {
        role: "button",
        label: "Continue",
        bounds: { x: 0, y: 0, width: 480, height: 144 },
        tokens: { spacing: { padding: 12 }, radius: { corner: 8 } },
      },
    };
    const svg = annotationSvg(tree);
    expect(svg).toContain("480×144 r8 p12");
    expect(svg).toMatch(/rx="8"[^>]*stroke="#7db4e8"/);
    expect(svg).toContain("M12,12 H468 V132 H12 Z");
  });

  it("draws one marked typography region for adjacent uses of the same style", () => {
    const tree: SemanticTree = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 200, height: 60 },
        children: [
          {
            role: "text",
            label: "Hi",
            bounds: { x: 10, y: 20, width: 80, height: 20 },
            tokens: {
              typography: { label: { fontFamily: "Roboto", fontSize: 14, fontWeight: 500, lineHeight: 20 } },
              colors: { label: "#ffffff" },
            },
          },
          {
            role: "text",
            label: "Again",
            bounds: { x: 100, y: 20, width: 80, height: 20 },
            tokens: {
              typography: { label: { fontFamily: "Roboto", fontSize: 14, fontWeight: 500, lineHeight: 20 } },
            },
          },
        ],
      },
    };
    const svg = annotationSvg(tree);
    expect(svg).toContain('<g data-layer="typography">');
    expect(svg.match(/class="anno-type"/g)).toHaveLength(1);
    expect(svg.match(/class="anno-type-hit"/g)).toHaveLength(2);
    expect(svg).toContain('data-type-marker="A"');
    expect(svg).toContain('stroke="#9f85ff"');
    expect(svg).toContain(">A</text>");
  });

  it("degrades to box + size when a node carries no radius/padding/type", () => {
    const tree: SemanticTree = {
      root: {
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        children: [{ role: "text", label: "x", bounds: { x: 4, y: 4, width: 40, height: 12 } }],
      },
    };
    const svg = annotationSvg(tree);
    expect(svg).toContain("40×12");
    // no padding/radius suffixes in the box-model tag when absent.
    expect(svg).not.toMatch(/×\d+ [rp]\d/);
    // border box drawn square (no rounding) when no radius.
    expect(svg).toContain('rx="0"');
    // no typography layer content (empty group) when no node carries type.
    expect(svg).toContain('<g data-layer="typography"></g>');
  });

  it("draws a layout-delta layer for a finding matched to a node by label", () => {
    const tree: SemanticTree = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 200, height: 80 },
        children: [{ role: "text", label: "Title", bounds: { x: 10, y: 10, width: 80, height: 20 } }],
      },
    };
    const svg = annotationSvg(tree, [{ label: "Title", dx: 0, dy: -8, dw: 0, dh: 0 }]);
    expect(svg).toContain('<g data-layer="layout">');
    expect(svg).toContain("Δpos 0,-8 · Δsize 0,0");
    expect(svg).toContain('stroke="#e8a23a"');
  });

  it("diff mode draws only the differing elements, under the toggleable layout layer", () => {
    const tree: SemanticTree = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 200, height: 80 },
        children: [
          { role: "text", label: "Title", bounds: { x: 10, y: 10, width: 80, height: 20 } },
          { role: "text", label: "Body", bounds: { x: 10, y: 40, width: 120, height: 20 } },
        ],
      },
    };
    const svg = annotationSvg(tree, [{ label: "Title", dx: 0, dy: -8, dw: 0, dh: 0 }], { diff: true });
    // Gated by the same `layout` toggle as the panels — hidden until selected,
    // not the old always-on `anno-diff` group.
    expect(svg).toContain('<g data-layer="layout">');
    expect(svg).not.toContain("anno-diff");
    // Only the matched (differing) element, with its drift; no box/typography layers.
    expect(svg).toContain("Δpos 0,-8 · Δsize 0,0");
    expect(svg).not.toContain("Body");
  });

  it("diff mode renders nothing when no element differs", () => {
    const tree: SemanticTree = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        children: [{ role: "text", label: "Here", bounds: { x: 0, y: 0, width: 40, height: 12 } }],
      },
    };
    expect(annotationSvg(tree, [], { diff: true })).toBe("");
    expect(annotationSvg(tree, [{ label: "Gone", dx: 1, dy: 1, dw: 0, dh: 0 }], { diff: true })).toBe("");
  });

  it("leaves the layout layer empty when no finding matches a node", () => {
    const tree: SemanticTree = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        children: [{ role: "text", label: "Here", bounds: { x: 0, y: 0, width: 40, height: 12 } }],
      },
    };
    const svg = annotationSvg(tree, [{ label: "Elsewhere", dx: 5, dy: 5, dw: 0, dh: 0 }]);
    expect(svg).toContain('<g data-layer="layout"></g>');
  });

  it("is deterministic for the same tree", () => {
    const tree: SemanticTree = {
      root: { role: "button", bounds: { x: 0, y: 0, width: 160, height: 48 }, tokens: { radius: { corner: 8 } } },
    };
    expect(annotationSvg(tree)).toBe(annotationSvg(tree));
  });
});
