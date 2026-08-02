import { describe, expect, it } from "vitest";

import {
  chooseAvailableFont,
  inferAutoLayout,
  normalizeSvgRects,
  svgFontRequests,
  svgTokenAnnotations,
} from "../src/nativeSvg.js";

describe("normalizeSvgRects", () => {
  it("turns a 50% pill into a clamped native rounded rect", () => {
    expect(normalizeSvgRects('<svg><rect x="0" y="0" width="120" height="40" rx="50%" ry="50%"/></svg>'))
      .toContain('width="120" height="40" rx="20" ry="20"');
  });

  it("clamps an over-large numeric radius the same way a browser paints it", () => {
    expect(normalizeSvgRects("<svg><rect width='72' height='32' rx='36'/></svg>"))
      .toContain("rx='16'");
  });

  it("does not flatten a genuinely elliptical corner or dynamic dimensions", () => {
    const elliptical = '<rect width="80" height="40" rx="12" ry="8"/>';
    const dynamic = '<rect width="100%" height="40" rx="50%"/>';
    expect(normalizeSvgRects(elliptical)).toBe(elliptical);
    expect(normalizeSvgRects(dynamic)).toBe(dynamic);
  });
});

describe("SVG metadata", () => {
  it("collects concrete text faces, weight and italic without generic fallbacks", () => {
    const svg = `<svg>
      <text font-family="Roboto, sans-serif" font-weight="700">One</text>
      <text font-family="'Space Grotesk', system-ui" font-weight="500" font-style="italic">Two</text>
      <text font-family="sans-serif">Generic</text>
    </svg>`;
    expect(svgFontRequests(svg)).toEqual([
      { family: "Roboto", weight: 700, italic: false },
      { family: "Space Grotesk", weight: 500, italic: true },
    ]);
  });

  it("chooses the closest face in the same family", () => {
    expect(chooseAvailableFont(
      { family: "Inter", weight: 600, italic: false },
      [
        { family: "Roboto", style: "Semi Bold" },
        { family: "Inter", style: "Regular" },
        { family: "Inter", style: "Semi Bold" },
        { family: "Inter", style: "Bold Italic" },
      ],
    )).toEqual({ family: "Inter", style: "Semi Bold" });
  });

  it("retains named theme-token hints before Figma strips SVG data attributes", () => {
    expect(svgTokenAnnotations('<g id="Button"><g id="Surface" data-token="primary"></g></g>'))
      .toEqual([{ layer: "Surface", token: "primary" }]);
  });
});

describe("inferAutoLayout", () => {
  it("infers a padded vertical list with a uniform gap", () => {
    expect(inferAutoLayout(
      { width: 200, height: 148 },
      [
        { x: 16, y: 12, width: 168, height: 36 },
        { x: 16, y: 56, width: 168, height: 36 },
        { x: 16, y: 100, width: 168, height: 36 },
      ],
    )).toEqual({
      mode: "VERTICAL",
      gap: 8,
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      counterAxisAlignItems: "CENTER",
      order: [0, 1, 2],
    });
  });

  it("infers content padding for a one-label pill", () => {
    expect(inferAutoLayout(
      { width: 96, height: 40 },
      [{ x: 20, y: 10, width: 56, height: 20 }],
    )).toMatchObject({
      mode: "HORIZONTAL",
      gap: 0,
      paddingTop: 10,
      paddingRight: 20,
      paddingBottom: 10,
      paddingLeft: 20,
      counterAxisAlignItems: "CENTER",
    });
  });

  it("leaves overlapping/freeform art out of Auto Layout", () => {
    expect(inferAutoLayout(
      { width: 48, height: 48 },
      [
        { x: 8, y: 8, width: 32, height: 32 },
        { x: 16, y: 16, width: 16, height: 16 },
      ],
    )).toBeUndefined();
  });
});
