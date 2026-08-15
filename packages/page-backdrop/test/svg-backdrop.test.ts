/**
 * Reading an addressable SVG backdrop.
 *
 * The cases worth pinning are the ones where the export looks fine and isn't:
 * markup that is not an SVG, and an SVG whose ids never arrived. Both degrade
 * silently downstream — "no element found", one placement at a time — which is
 * why the importer asks here rather than finding out in a viewer.
 */
import { describe, expect, it } from "vitest";

import {
  assertAddressableSvg,
  canonicalNodeId,
  countNodeIds,
  nodeIdsIn,
  svgFrameSize,
  svgNodeId,
} from "../src/svg-backdrop.js";

const EXPORT =
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="800" viewBox="0 0 360 800" fill="none">` +
  `<g data-node-id="12-34"><rect data-node-id="12-35" width="100" height="40"/></g>` +
  `<g data-node-id="12-34"><path d="M0 0"/></g>` +
  `</svg>`;

describe("node id spelling", () => {
  it("canonicalises the URL spelling to the API one", () => {
    expect(canonicalNodeId("12-34")).toBe("12:34");
    expect(canonicalNodeId("12:34")).toBe("12:34");
  });

  it("goes back the other way for a markup lookup", () => {
    expect(svgNodeId("12:34")).toBe("12-34");
    expect(svgNodeId("12-34")).toBe("12-34");
  });
});

describe("nodeIdsIn", () => {
  it("returns each id once, in the API spelling", () => {
    expect(nodeIdsIn(EXPORT)).toEqual(["12:34", "12:35"]);
  });

  it("is empty for a picture", () => {
    expect(nodeIdsIn(`<svg viewBox="0 0 1 1"><rect/></svg>`)).toEqual([]);
  });
});

describe("countNodeIds", () => {
  it("counts attributes, not distinct ids", () => {
    // One component drawn as two groups is two elements to address, and the
    // importer's question is "did ids arrive at all", not "how many nodes".
    expect(countNodeIds(EXPORT)).toBe(3);
  });
});

describe("svgFrameSize", () => {
  it("prefers the viewBox — the space the ids are positioned in", () => {
    const svg = `<svg width="720" height="1600" viewBox="0 0 360 800"></svg>`;
    expect(svgFrameSize(svg)).toEqual({ width: 360, height: 800 });
  });

  it("falls back to width and height", () => {
    expect(svgFrameSize(`<svg width="360" height="800"></svg>`)).toEqual({
      width: 360,
      height: 800,
    });
  });

  it("accepts a comma-separated viewBox", () => {
    expect(svgFrameSize(`<svg viewBox="0,0,10,20"></svg>`)).toEqual({ width: 10, height: 20 });
  });

  it("ignores a degenerate viewBox rather than reporting a zero frame", () => {
    expect(svgFrameSize(`<svg viewBox="0 0 0 0" width="8" height="9"></svg>`)).toEqual({
      width: 8,
      height: 9,
    });
  });

  it("throws when the export declares no size at all", () => {
    expect(() => svgFrameSize(`<svg></svg>`)).toThrow(/no usable viewBox or size/);
  });
});

describe("assertAddressableSvg", () => {
  it("accepts an export carrying ids", () => {
    expect(() => assertAddressableSvg(EXPORT, "12:34")).not.toThrow();
  });

  it("rejects markup that is not an SVG", () => {
    // What a signed URL returns once it has expired.
    expect(() => assertAddressableSvg(`<!doctype html><html>...`, "12:34")).toThrow(
      /did not start with an <svg> element/,
    );
  });

  it("rejects a picture", () => {
    expect(() => assertAddressableSvg(`<svg viewBox="0 0 1 1"><rect/></svg>`, "12:34")).toThrow(
      /carries no data-node-id/,
    );
  });
});
