import { describe, it, expect } from "vitest";

import {
  CANONICAL_SIZES,
  SIZE_BREAKPOINTS,
  sizeForWidth,
  normalizeSize,
} from "../src/index.js";

describe("size vocabulary", () => {
  it("exposes the canonical set and Material breakpoints", () => {
    expect(CANONICAL_SIZES).toEqual(["compact", "medium", "expanded"]);
    expect(SIZE_BREAKPOINTS).toEqual({ medium: 600, expanded: 840 });
  });

  it.each([
    [0, "compact"],
    [599, "compact"],
    [600, "medium"],
    [839, "medium"],
    [840, "expanded"],
    [1600, "expanded"],
  ] as const)("sizeForWidth(%i) = %s", (w, expected) => {
    expect(sizeForWidth(w)).toBe(expected);
  });

  it.each([
    ["compact", "compact"],
    ["Compact", "compact"],
    ["MEDIUM", "medium"],
    ["600", "medium"],
    ["600dp", "medium"],
    ["840px", "expanded"],
    ["599", "compact"],
  ] as const)("normalizeSize(%s) = %s", (input, expected) => {
    expect(normalizeSize(input)).toBe(expected);
  });

  it("normalizes a numeric width", () => {
    expect(normalizeSize(720)).toBe("medium");
  });

  it.each(["", "  ", "phone", "large", "xl", "not-a-size"])(
    "returns undefined for the unknown label %j",
    (input) => {
      expect(normalizeSize(input)).toBeUndefined();
    },
  );

  it("returns undefined for undefined / non-finite", () => {
    expect(normalizeSize(undefined)).toBeUndefined();
    expect(normalizeSize(Number.NaN)).toBeUndefined();
  });

  it("returns undefined for null (an unset widthDp serializes as JSON null)", () => {
    // A preview bundle's `params.widthDp` is `null` when the @Preview pins no
    // width; the candidate reader passes it straight to normalizeSize, which
    // must not throw on `.trim()`.
    expect(normalizeSize(null)).toBeUndefined();
  });
});
