import type { SemanticTree } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildWireframeSvg } from "../src/wireframe.js";

const tree: SemanticTree = {
  root: {
    bounds: { x: 0, y: 0, width: 100, height: 60 },
    children: [
      { role: "button", bounds: { x: 8, y: 8, width: 84, height: 44 } },
      { bounds: { x: 8, y: 8, width: 40, height: 20 } },
      { role: "spacer" }, // no bounds — contributes no rect
    ],
  },
};

describe("buildWireframeSvg", () => {
  it("draws one bordered rect per boxed node, sized to the union viewport", () => {
    const svg = buildWireframeSvg(tree)!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 100 60"');
    expect(svg).toContain('width="100"');
    // root + 2 boxed children = 3 rects; the boundsless node contributes none.
    expect((svg.match(/<rect /g) ?? [])).toHaveLength(3);
    // No fills — a schematic, not a picture.
    expect(svg).toContain('fill="none"');
  });

  it("is deterministic — the same tree yields byte-identical SVG", () => {
    expect(buildWireframeSvg(tree)).toBe(buildWireframeSvg(tree));
  });

  it("returns undefined when nothing carries a box", () => {
    expect(buildWireframeSvg({ root: { role: "text" } })).toBeUndefined();
    expect(buildWireframeSvg(undefined)).toBeUndefined();
  });

  it("uses the union of all boxes when the root has none", () => {
    const svg = buildWireframeSvg({
      root: {
        children: [
          { bounds: { x: 10, y: 10, width: 30, height: 30 } },
          { bounds: { x: 50, y: 20, width: 40, height: 60 } },
        ],
      },
    })!;
    // union: x 10..90, y 10..80 → viewBox "10 10 80 70"
    expect(svg).toContain('viewBox="10 10 80 70"');
  });
});
