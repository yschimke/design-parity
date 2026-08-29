import { describe, it, expect } from "vitest";

import { gutterFor, isRtlLocale } from "../src/cli.js";

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

describe("gutterFor — writing-direction edges", () => {
  it("maps start to the left edge under an LTR locale", () => {
    expect(gutterFor({ captureGutter: { start: 8, end: 2 }, locale: "en-US" }))
      .toEqual({ start: 8, top: 0, end: 2, bottom: 0 });
  });

  it("swaps start and end under an RTL locale, where start IS the right edge", () => {
    // The crop works in physical pixels, so an unswapped `start` would trim the
    // wrong side: the real gutter survives and the component shifts.
    expect(gutterFor({ captureGutter: { start: 8, end: 2 }, locale: "ar-EG" }))
      .toEqual({ start: 2, top: 0, end: 8, bottom: 0 });
  });

  it("reads the language subtag, not the whole tag, and defaults to LTR", () => {
    expect(isRtlLocale("he")).toBe(true);
    expect(isRtlLocale("iw_IL")).toBe(true);
    expect(isRtlLocale("en-AR")).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it("is a no-op for the symmetric gutter every real case uses", () => {
    const even = { start: 8, top: 8, end: 8, bottom: 8 };
    expect(gutterFor({ captureGutter: even, locale: "ar" }))
      .toEqual(gutterFor({ captureGutter: even, locale: "en" }));
  });
});

describe("gutterFor — density fallback", () => {
  it("reads the device's own dpi when density is absent", () => {
    // A bundle saying dpi=320 has already told us it is 2x; reading it as 1x
    // would crop 8px off a 16px gutter and leave the residual frame.
    expect(gutterFor({
      captureGutter: { start: 8, top: 8, end: 8, bottom: 8 },
      device: "spec:width=192dp,height=192dp,dpi=320,isRound=true",
    })).toEqual({ start: 16, top: 16, end: 16, bottom: 16 });
  });

  it("prefers an explicit density over the device dpi", () => {
    expect(gutterFor({
      captureGutter: { start: 8 },
      density: 3,
      device: "spec:dpi=320",
    })?.start).toBe(24);
  });
});
