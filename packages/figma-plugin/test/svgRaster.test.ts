import { describe, expect, it } from "vitest";

import { inlineSvgRasters, svgRasterHrefs } from "../src/svgRaster.js";

describe("svgRasterHrefs", () => {
  it("finds external href / xlink:href targets, skips data URIs, dedupes in order", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<image href="button.figma-raster/node-3.png" x="0"/>',
      "<image xlink:href='button.figma-raster/node-7.png'/>",
      '<image href="button.figma-raster/node-3.png"/>', // duplicate
      '<image href="data:image/png;base64,AAAA"/>', // already inlined → skipped
      "</svg>",
    ].join("");
    expect(svgRasterHrefs(svg)).toEqual([
      "button.figma-raster/node-3.png",
      "button.figma-raster/node-7.png",
    ]);
  });

  it("returns [] for a vector-only SVG", () => {
    expect(svgRasterHrefs('<svg><rect width="10" height="10"/></svg>')).toEqual([]);
  });
});

describe("inlineSvgRasters", () => {
  it("replaces the exact quoted href with its data URI (both quote styles)", () => {
    const svg = `<image href="a/node-3.png"/><image xlink:href='a/node-7.png'/>`;
    const map = new Map([
      ["a/node-3.png", "data:image/png;base64,AAA"],
      ["a/node-7.png", "data:image/png;base64,BBB"],
    ]);
    expect(inlineSvgRasters(svg, map)).toBe(
      `<image href="data:image/png;base64,AAA"/><image xlink:href='data:image/png;base64,BBB'/>`,
    );
  });

  it("does not let a shorter href clobber a longer one it prefixes", () => {
    // "x/n.png" is a prefix of "x/n.png2"; quoted-value replacement keeps them distinct.
    const svg = `<image href="x/n.png"/><image href="x/n.png2"/>`;
    const map = new Map([["x/n.png", "data:A"]]);
    expect(inlineSvgRasters(svg, map)).toBe(`<image href="data:A"/><image href="x/n.png2"/>`);
  });

  it("leaves hrefs absent from the map untouched", () => {
    const svg = `<image href="keep.png"/>`;
    expect(inlineSvgRasters(svg, new Map())).toBe(svg);
  });
});
