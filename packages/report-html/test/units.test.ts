import { describe, it, expect } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import { inCodeUnits } from "../src/units.js";

/** A 3× board: tokens are board pixels, and the tree says so. */
const scaled = (): SemanticTree => ({
  root: {
    role: "group",
    bounds: { x: 0, y: 0, width: 480, height: 144 },
    tokens: { spacing: { paddingStart: 48, gap: 24 }, colors: { container: "#8A82FF" } },
    children: [
      {
        role: "text",
        label: "Continue",
        bounds: { x: 48, y: 36, width: 384, height: 72 },
        tokens: {
          radius: { corner: 24 },
          typography: {
            label: {
              fontFamily: "Roboto",
              fontWeight: 500,
              fontSize: 42,
              lineHeight: 60,
              letterSpacing: 1.5,
            },
          },
        },
      },
    ],
  },
  density: 3,
  boundsDensity: 3,
});

describe("inCodeUnits", () => {
  it("divides every token length through by the stated density", () => {
    const out = inCodeUnits(scaled())!;
    expect(out.root.tokens!.spacing).toEqual({ paddingStart: 16, gap: 8 });
    const child = out.root.children![0]!;
    expect(child.tokens!.radius).toEqual({ corner: 8 });
    expect(child.tokens!.typography!["label"]).toEqual({
      fontFamily: "Roboto",
      fontWeight: 500,
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0.5,
    });
  });

  it("leaves colours, weights and families alone — they aren't lengths", () => {
    const out = inCodeUnits(scaled())!;
    expect(out.root.tokens!.colors).toEqual({ container: "#8A82FF" });
    expect(out.root.children![0]!.tokens!.typography!["label"]!.fontWeight).toBe(500);
  });

  it("leaves bounds and boundsDensity untouched — they are the other half of the tree", () => {
    const out = inCodeUnits(scaled())!;
    expect(out.root.bounds).toEqual({ x: 0, y: 0, width: 480, height: 144 });
    expect(out.root.children![0]!.bounds).toEqual({ x: 48, y: 36, width: 384, height: 72 });
    expect(out.boundsDensity).toBe(3);
  });

  it("drops the stated density, so converting twice converts once", () => {
    const once = inCodeUnits(scaled())!;
    expect(once.density).toBeUndefined();
    expect(inCodeUnits(once)).toBe(once);
  });

  it("rounds like the adapter does — a divided capture is a measurement, not a spec", () => {
    const tree: SemanticTree = {
      root: { role: "text", bounds: { x: 0, y: 0, width: 10, height: 10 }, tokens: { spacing: { gap: 48 } } },
      density: 2.625,
    };
    expect(inCodeUnits(tree)!.root.tokens!.spacing!["gap"]).toBe(18.29);
  });

  it("leaves an unstated density exactly as captured, object identity included", () => {
    const raw: SemanticTree = {
      root: { role: "group", bounds: { x: 0, y: 0, width: 411, height: 914 }, tokens: { spacing: { gap: 8 } } },
      boundsDensity: 2.625,
    };
    expect(inCodeUnits(raw)).toBe(raw);
    // Not a scale is not a scale: never a guess at 1×, never a divide by zero.
    expect(inCodeUnits({ ...raw, density: 0 })!.root.tokens!.spacing).toEqual({ gap: 8 });
    expect(inCodeUnits({ ...raw, density: -2 })!.root.tokens!.spacing).toEqual({ gap: 8 });
    expect(inCodeUnits({ ...raw, density: Number.NaN })!.root.tokens!.spacing).toEqual({ gap: 8 });
    expect(inCodeUnits(undefined)).toBeUndefined();
  });
});
