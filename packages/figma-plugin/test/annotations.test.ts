import type { Redline } from "@design-parity/catalog-export";
import { describe, expect, it } from "vitest";

import { redlineLabel, redlineRgb, severityHex, severityRgb } from "../src/annotations.js";

describe("severity colours", () => {
  it("maps each severity to a stable hex and matching RGB", () => {
    expect(severityHex("info")).toBe("#1a7f37");
    expect(severityHex("warn")).toBe("#bf8700");
    expect(severityHex("error")).toBe("#cf222e");
    expect(severityRgb("error")).toEqual({
      r: 0xcf / 255,
      g: 0x22 / 255,
      b: 0x2e / 255,
    });
  });
});

describe("redlineLabel", () => {
  it("summarizes role, padding (top/end/bottom/start), gap, and radius", () => {
    const r: Redline = {
      role: "Column",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      padding: { top: 16, end: 12, bottom: 16, start: 12 },
      gap: 8,
      cornerRadius: 12,
    };
    expect(redlineLabel(r)).toBe("Column · pad 16/12/16/12 · gap 8 · r 12");
  });

  it("prefers label over role and fills missing padding edges with 0", () => {
    const r: Redline = {
      role: "Column",
      label: "Content",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      padding: { top: 8 },
    };
    expect(redlineLabel(r)).toBe("Content · pad 8/0/0/0");
  });

  it("returns an empty string for a redline with no measurable spec", () => {
    expect(redlineLabel({ bounds: { x: 0, y: 0, width: 10, height: 10 } })).toBe("");
  });

  it("exposes the redline accent as RGB", () => {
    expect(redlineRgb()).toEqual({ r: 0x09 / 255, g: 0x69 / 255, b: 0xda / 255 });
  });
});
