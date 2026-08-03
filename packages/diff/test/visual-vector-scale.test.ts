import { describe, it, expect } from "vitest";

import type { Image } from "@design-parity/core";
import { PNG } from "pngjs";

import { diffImagePair } from "../src/visual.js";
import { defaultDiffConfig } from "../src/config.js";

/** A solid-colour PNG of the given size, as a `data:` URI. */
function solidPng(
  width: number,
  height: number,
  [r, g, b]: [number, number, number] = [0x40, 0x80, 0xc0],
): string {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 0xff;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

/** A solid-colour SVG of the given user-unit size, as a `data:` URI. */
function solidSvg(width: number, height: number, fill = "#4080c0"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function img(uri: string, width: number, height: number): Image {
  return { state: "default", theme: "light", uri, width, height };
}

describe("vector reference rasterisation scale", () => {
  it("rasterises an SVG reference to the candidate's width instead of a blind 2x", async () => {
    // The meshcore-mobile shape: a Figma frame seeded from an already-device-pixel
    // export (1078x2399 user units) against a Compose render at the same device
    // pixels. Rasterised at the old fixed 2x the reference came out 2156px wide —
    // a 1078px delta, far past `visualDimTolerancePx` — so the pair scored a flat
    // 100% mismatch that said nothing about the design.
    const ref = img(solidSvg(1078, 2399), 1078, 2399);
    const cand = img(solidPng(1078, 2399), 1078, 2399);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.totalPixels).toBe(1078 * 2399);
    expect(r.score).toBeLessThan(0.01);
  });

  it("lines up a dp-authored SVG frame with a higher-density candidate", async () => {
    // The other direction: a frame authored in dp (411x914) against a 2.625x
    // Compose render (1078x2399). A fixed 2x gave 822px vs 1078px — also a total
    // mismatch. Scaling to the candidate's width makes the two comparable.
    const ref = img(solidSvg(411, 914), 411, 914);
    const cand = img(solidPng(1078, 2399), 1078, 2399);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    // 411:914 and 1078:2399 are the same aspect to within a pixel of height, so
    // scaling by width lands inside the dimension tolerance rather than blowing
    // past it.
    expect(r.score).toBeLessThan(0.01);
  });

  it("still reports real content drift once the scales agree", async () => {
    // Scaling to a common size must not paper over an actual colour difference.
    const ref = img(solidSvg(411, 914, "#202020"), 411, 914);
    const cand = img(solidPng(1078, 2399, [0xe0, 0xe0, 0xe0]), 1078, 2399);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.score).toBeGreaterThan(0.9);
  });
});
