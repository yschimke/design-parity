import { describe, it, expect } from "vitest";

import type { Image } from "@design-parity/core";
import { PNG } from "pngjs";

import { diffImagePair } from "../src/visual.js";
import { defaultDiffConfig, type DiffConfig } from "../src/config.js";

const RGB: [number, number, number] = [0x40, 0x80, 0xc0];

/** A `w×h` solid block placed at (`x`, `y`) on a transparent `cw×ch` canvas. */
function onCanvas(
  [cw, ch]: [number, number],
  [w, h]: [number, number],
  [x, y]: [number, number],
): string {
  const png = new PNG({ width: cw, height: ch });
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const i = (py * cw + px) * 4;
      const inside = px >= x && px < x + w && py >= y && py < y + h;
      png.data[i] = RGB[0];
      png.data[i + 1] = RGB[1];
      png.data[i + 2] = RGB[2];
      png.data[i + 3] = inside ? 0xff : 0x00;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

const solid = (w: number, h: number) => onCanvas([w, h], [w, h], [0, 0]);

function img(uri: string, width: number, height: number): Image {
  return { state: "default", theme: "light", uri, width, height };
}

const crop: DiffConfig = { ...defaultDiffConfig, visualCandidateFrame: "crop-to-content" };

describe("candidate frame crop (wear-m3-catalog#138)", () => {
  // A Remote Compose sticker: a 104×52 component drawn on a fixed 227×100 canvas, off-centre.
  const framed = img(onCanvas([227, 100], [104, 52], [12, 30]), 227, 100);
  const tight = img(solid(104, 52), 104, 52);

  it("keeps the frame by default, so an unconfigured repo is compared as before", async () => {
    const r = await diffImagePair("/nonexistent", tight, framed, defaultDiffConfig);
    expect(r.dimensionMismatch).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.candidatePng).toBeUndefined();
  });

  it("crops the candidate to its content against a tight reference", async () => {
    const r = await diffImagePair("/nonexistent", tight, framed, crop);
    expect(r.score).toBe(0);
    expect(r.dimensionMismatch).toBeUndefined();
    // What was compared is not what is on disk, so the consumer is handed it.
    const compared = PNG.sync.read(r.candidatePng!);
    expect([compared.width, compared.height]).toEqual([104, 52]);
  });

  it("compares whole when the reference specifies a transparent margin of its own", async () => {
    // A display cell: the design's own canvas is transparent around a small indicator.
    const displayCell = img(onCanvas([192, 192], [36, 8], [78, 170]), 192, 192);
    const candidate = img(onCanvas([192, 192], [36, 8], [78, 170]), 192, 192);
    const r = await diffImagePair("/nonexistent", displayCell, candidate, crop);
    expect(r.score).toBe(0);
    expect(r.candidatePng).toBeUndefined();
  });

  it("leaves a candidate with no transparent margin untouched", async () => {
    const r = await diffImagePair("/nonexistent", tight, tight, crop);
    expect(r.score).toBe(0);
    expect(r.candidatePng).toBeUndefined();
  });

  it("leaves an empty candidate untouched rather than cropping to nothing", async () => {
    const empty = img(onCanvas([227, 100], [0, 0], [0, 0]), 227, 100);
    const r = await diffImagePair("/nonexistent", tight, empty, crop);
    expect(r.candidatePng).toBeUndefined();
    expect(r.dimensionMismatch).toBe(true);
  });
});
