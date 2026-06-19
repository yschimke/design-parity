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

  it("draws a typography callout with family/size/weight/line-height", () => {
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
        ],
      },
    };
    const svg = annotationSvg(tree);
    expect(svg).toContain('<g data-layer="typography">');
    expect(svg).toContain("Roboto · 14sp · 500 · lh 20");
    // the resolved text colour renders as a swatch.
    expect(svg).toContain('fill="#ffffff"');
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

  it("diff mode draws only the differing elements, always-on (no toggle layer)", () => {
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
    // Always-on group (no data-layer so the toggle controls can't hide it).
    expect(svg).toContain('<g class="anno-diff">');
    expect(svg).not.toContain("data-layer");
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
