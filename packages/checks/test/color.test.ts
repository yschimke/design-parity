import { describe, it, expect } from "vitest";

import { contrastRatio, parseColor, round2 } from "../src/index.js";

describe("parseColor", () => {
  it.each([
    ["#fff", { r: 255, g: 255, b: 255, a: 1 }],
    ["#000000", { r: 0, g: 0, b: 0, a: 1 }],
    ["#645AFF", { r: 100, g: 90, b: 255, a: 1 }],
    ["#00000080", { r: 0, g: 0, b: 0, a: 128 / 255 }],
    ["rgb(255, 0, 0)", { r: 255, g: 0, b: 0, a: 1 }],
  ])("parses %s", (input, expected) => {
    expect(parseColor(input)).toEqual(expected);
  });

  it("returns undefined for junk", () => {
    expect(parseColor("not-a-color")).toBeUndefined();
    expect(parseColor("#xyz")).toBeUndefined();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(round2(contrastRatio(parseColor("#000")!, parseColor("#fff")!))).toBe(
      21,
    );
  });

  it("is 1 for a color against itself", () => {
    expect(contrastRatio(parseColor("#645AFF")!, parseColor("#645AFF")!)).toBe(1);
  });

  it("flattens translucent foregrounds over the background", () => {
    const opaque = contrastRatio(parseColor("#000")!, parseColor("#fff")!);
    const translucent = contrastRatio(parseColor("#00000080")!, parseColor("#fff")!);
    expect(translucent).toBeLessThan(opaque);
  });
});
