import { describe, it, expect } from "vitest";

import { svgSize } from "../src/svg.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("svgSize", () => {
  it("reads explicit width/height", () => {
    expect(svgSize(enc('<svg width="160" height="48" viewBox="0 0 160 48"></svg>'))).toEqual({
      width: 160,
      height: 48,
    });
  });

  it("falls back to the viewBox when width/height are missing or non-px", () => {
    expect(svgSize(enc('<svg width="100%" viewBox="0 0 320 96"><g/></svg>'))).toEqual({
      width: 320,
      height: 96,
    });
  });

  it("throws when the bytes are not an SVG", () => {
    expect(() => svgSize(enc("<html></html>"))).toThrow(/not an SVG/);
  });
});
