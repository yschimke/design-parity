import { describe, it, expect } from "vitest";

import {
  parseStitchRef,
  formatStitchRef,
  isStitchRef,
} from "../src/stitch-ref.js";
import { StitchBadRefError } from "../src/errors.js";

describe("parseStitchRef", () => {
  it("parses a stitch:<project>/<screen> handle", () => {
    expect(parseStitchRef("stitch:design/abc123")).toEqual({
      projectId: "design",
      screenId: "abc123",
    });
  });

  it("tolerates surrounding whitespace and dotted/dashed ids", () => {
    expect(parseStitchRef("  stitch:my-proj.v2/screen_1  ")).toEqual({
      projectId: "my-proj.v2",
      screenId: "screen_1",
    });
  });

  it("round-trips through formatStitchRef", () => {
    const ref = "stitch:design/abc123";
    expect(formatStitchRef(parseStitchRef(ref))).toBe(ref);
  });

  it.each(["stitch:nope", "figma:KEY/1:2", "design/abc123", "stitch:/x", "stitch:x/"])(
    "rejects malformed ref %s",
    (bad) => {
      expect(() => parseStitchRef(bad)).toThrow(StitchBadRefError);
      expect(isStitchRef(bad)).toBe(false);
    },
  );

  it("isStitchRef is true for a valid handle", () => {
    expect(isStitchRef("stitch:design/abc123")).toBe(true);
  });
});
