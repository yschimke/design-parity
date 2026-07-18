import { describe, it, expect } from "vitest";

import { parseSvgSize } from "../src/index.js";

describe("parseSvgSize", () => {
  it("reads explicit width/height attributes (px and bare numbers)", () => {
    expect(parseSvgSize('<svg width="240px" height="160" viewBox="0 0 1 1"></svg>')).toEqual({
      width: 240,
      height: 160,
    });
  });

  it("falls back to the viewBox extent when width/height are absent", () => {
    expect(parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 411 914"><rect/></svg>')).toEqual({
      width: 411,
      height: 914,
    });
  });

  it("ignores non-pixel units and uses the viewBox instead", () => {
    // A `width="100%"` carries no intrinsic pixel size; the viewBox does.
    expect(parseSvgSize('<svg width="100%" height="100%" viewBox="0 0 48 24"></svg>')).toEqual({
      width: 48,
      height: 24,
    });
  });

  it("rounds fractional dimensions to whole pixels", () => {
    expect(parseSvgSize('<svg viewBox="0 0 240.4 159.6"></svg>')).toEqual({ width: 240, height: 160 });
  });

  it("throws when there is no svg root", () => {
    expect(() => parseSvgSize("<html><body>nope</body></html>")).toThrow(/not an SVG/);
  });

  it("throws when no usable size can be derived", () => {
    expect(() => parseSvgSize('<svg width="100%" height="100%"></svg>')).toThrow(
      /no usable SVG dimensions/,
    );
  });
});
