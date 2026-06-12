import { describe, it, expect } from "vitest";

import {
  parseFigmaRef,
  formatFigmaRef,
  isFigmaRef,
} from "../src/figma-ref.js";
import { FigmaBadRefError } from "../src/errors.js";

describe("parseFigmaRef", () => {
  it("parses the manifest form with a colon node id", () => {
    expect(parseFigmaRef("figma:AbCdEf123456/1:42")).toEqual({
      fileKey: "AbCdEf123456",
      nodeId: "1:42",
    });
  });

  it("canonicalizes a dash node id to a colon", () => {
    expect(parseFigmaRef("figma:KEY1/1-42").nodeId).toBe("1:42");
  });

  it("parses a figma.com design URL", () => {
    const ref = parseFigmaRef(
      "https://www.figma.com/design/AbCdEf123456/Buttons?node-id=1-42&t=x",
    );
    expect(ref).toEqual({ fileKey: "AbCdEf123456", nodeId: "1:42" });
  });

  it("parses a legacy /file/ URL", () => {
    expect(parseFigmaRef("https://figma.com/file/KEY/Name?node-id=10-2").fileKey).toBe(
      "KEY",
    );
  });

  it("throws FigmaBadRefError on a non-figma ref", () => {
    expect(() => parseFigmaRef("stitch:design/abc")).toThrow(FigmaBadRefError);
  });

  it("round-trips through formatFigmaRef", () => {
    const ref = parseFigmaRef("figma:KEY/2:3");
    expect(formatFigmaRef(ref)).toBe("figma:KEY/2:3");
  });

  it("isFigmaRef distinguishes handles from manifest refs", () => {
    expect(isFigmaRef("figma:KEY/1:2")).toBe(true);
    expect(isFigmaRef("design/reference/card.html")).toBe(false);
  });
});
