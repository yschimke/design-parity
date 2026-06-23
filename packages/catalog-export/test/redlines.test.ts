import { describe, expect, it } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import { buildRedlines } from "../src/redlines.js";

describe("buildRedlines", () => {
  it("emits a redline per node carrying box + padding / gap / corner radius", () => {
    const tree: SemanticTree = {
      root: {
        role: "button",
        label: "Save",
        bounds: { x: 0, y: 0, width: 120, height: 48 },
        tokens: {
          spacing: { paddingStart: 24, paddingEnd: 24, paddingTop: 10, paddingBottom: 10, gap: 8 },
          radius: { corner: 20 },
        },
        children: [
          // a slot with its own box but no spacing tokens → no redline
          { role: "text", label: "Save", bounds: { x: 24, y: 14, width: 40, height: 20 } },
        ],
      },
    };
    const redlines = buildRedlines(tree);
    expect(redlines).toHaveLength(1);
    expect(redlines[0]).toEqual({
      role: "button",
      label: "Save",
      bounds: { x: 0, y: 0, width: 120, height: 48 },
      padding: { start: 24, top: 10, end: 24, bottom: 10 },
      gap: 8,
      cornerRadius: 20,
    });
  });

  it("expands a uniform `padding` token to all four edges", () => {
    const tree: SemanticTree = {
      root: { bounds: { x: 0, y: 0, width: 80, height: 80 }, tokens: { spacing: { padding: 12 } } },
    };
    expect(buildRedlines(tree)[0]?.padding).toEqual({ start: 12, top: 12, end: 12, bottom: 12 });
  });

  it("recurses, and skips nodes with no box or no spacing", () => {
    const tree: SemanticTree = {
      root: {
        children: [
          { role: "text", label: "x" }, // no bounds → skipped
          {
            role: "card",
            bounds: { x: 0, y: 0, width: 200, height: 100 },
            tokens: { radius: { corner: 12 } },
            children: [
              { bounds: { x: 8, y: 8, width: 80, height: 24 }, tokens: { spacing: { gap: 4 } } },
            ],
          },
        ],
      },
    };
    const redlines = buildRedlines(tree);
    expect(redlines.map((r) => r.cornerRadius ?? r.gap)).toEqual([12, 4]);
  });

  it("returns [] for an undefined tree", () => {
    expect(buildRedlines(undefined)).toEqual([]);
  });
});
