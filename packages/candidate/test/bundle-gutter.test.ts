import { describe, it, expect } from "vitest";

import { gutterFor } from "../src/bundle.js";

describe("gutterFor — @CaptureGutter dp resolved to px", () => {
  it("scales by the render density", () => {
    expect(gutterFor({ captureGutter: { start: 8, top: 8, end: 8, bottom: 8 }, density: 2 }))
      .toEqual({ start: 16, top: 16, end: 16, bottom: 16 });
  });

  it("reads a stated gutter as dp when density is absent, rather than guessing", () => {
    // dp = px at 1x. Assuming a higher density would crop away real content, so
    // the conservative reading is the safe one.
    expect(gutterFor({ captureGutter: { start: 8, top: 8, end: 8, bottom: 8 } }))
      .toEqual({ start: 8, top: 8, end: 8, bottom: 8 });
  });

  it("defaults each omitted edge to zero", () => {
    expect(gutterFor({ captureGutter: { top: 4 }, density: 2 }))
      .toEqual({ start: 0, top: 8, end: 0, bottom: 0 });
  });

  it("has nothing to say when there is no gutter", () => {
    expect(gutterFor({})).toBeUndefined();
    expect(gutterFor({ captureGutter: null })).toBeUndefined();
    // An all-zero gutter says the same thing as no gutter; don't invite a no-op crop.
    expect(gutterFor({ captureGutter: { start: 0, top: 0, end: 0, bottom: 0 } })).toBeUndefined();
  });

  it("rounds to whole pixels and ignores a nonsensical density or edge", () => {
    expect(gutterFor({ captureGutter: { start: 3 }, density: 2.625 })?.start).toBe(8);
    expect(gutterFor({ captureGutter: { start: 8 }, density: 0 })?.start).toBe(8);
    expect(gutterFor({ captureGutter: { start: -4, top: 8 }, density: 1 })?.start).toBe(0);
  });
});
