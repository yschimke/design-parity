import { describe, it, expect } from "vitest";

import type { Image, ImageGutter } from "@design-parity/core";
import { PNG } from "pngjs";

import { cropGutter, diffImagePair } from "../src/visual.js";
import { defaultDiffConfig } from "../src/config.js";

/**
 * A solid block of `[r,g,b]` on a transparent margin of `gutter` px — the shape
 * a renderer produces for a declared `@CaptureGutter`.
 */
function guttered(
  inner: [number, number],
  gutter: number,
  [r, g, b]: [number, number, number] = [0x40, 0x80, 0xc0],
): string {
  const [iw, ih] = inner;
  const png = new PNG({ width: iw + gutter * 2, height: ih + gutter * 2 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const inside = x >= gutter && x < gutter + iw && y >= gutter && y < gutter + ih;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = inside ? 0xff : 0x00;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function solid(width: number, height: number, rgb: [number, number, number] = [0x40, 0x80, 0xc0]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 0xff;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function img(uri: string, width: number, height: number, gutter?: ImageGutter): Image {
  const i: Image = { state: "default", theme: "light", uri, width, height };
  if (gutter) i.gutter = gutter;
  return i;
}

const even = (n: number): ImageGutter => ({ start: n, top: n, end: n, bottom: n });

describe("declared capture gutter (wear-m3-catalog#138)", () => {
  it("scores a pixel-exact component as matching once its gutter is declared", async () => {
    // The component IS its reference: 104x104 of identical pixels. The only
    // difference is the 16px transparent frame the renderer added around it.
    const ref = img(solid(104, 104), 104, 104);
    const cand = img(guttered([104, 104], 16), 136, 136, even(16));

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBeFalsy();
    expect(r.score).toBe(0);
  });

  it("is what separates a match from a ~30% miss: the same pair, undeclared", async () => {
    // Identical bytes to the case above, minus the declaration. This is the
    // bug: the gutter is not a border to tolerate, it offsets the content under
    // a top-left alignment and leaves an uncovered frame.
    const ref = img(solid(104, 104), 104, 104);
    const undeclared = img(guttered([104, 104], 16), 136, 136);

    const r = await diffImagePair("/nonexistent", ref, undeclared, defaultDiffConfig);

    expect(r.dimensionMismatch).toBe(true);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it("leaves an image with no declared gutter exactly as it was", () => {
    const raster = { width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4, 0x7f) };
    expect(cropGutter(raster)).toBe(raster);
  });

  it("refuses a declaration that would crop the image away, rather than erroring", () => {
    // A bad declaration degrades to the old comparison; it never produces a
    // zero-sized raster for pixelmatch to choke on.
    const raster = { width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4, 0x7f) };
    expect(cropGutter(raster, even(2))).toBe(raster);
    expect(cropGutter(raster, even(9))).toBe(raster);
  });

  it("crops each edge independently, keeping the pixels the offsets name", () => {
    // Every pixel gets a distinct red channel = y * width + x, so a start/end or
    // top/bottom swap picks a different region and fails. Asserting only the
    // output dimensions would pass for any 2x1 crop, which is the whole bug
    // this test exists to catch.
    const png = new PNG({ width: 5, height: 4 });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        const i = (y * 5 + x) * 4;
        png.data[i] = y * 5 + x;
        png.data[i + 1] = 0;
        png.data[i + 2] = 0;
        png.data[i + 3] = 0xff;
      }
    }
    const raster = { width: 5, height: 4, data: png.data };

    const out = cropGutter(raster, { start: 1, top: 2, end: 2, bottom: 1 });

    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    // Row y=2, columns x=1..2 — ids 11 and 12.
    expect([out.data[0], out.data[4]]).toEqual([11, 12]);
    expect(out.data[3]).toBe(0xff);
  });

  it("publishes the cropped candidate, so a report can show what was compared", async () => {
    // The panel a human reviews has to be the image the score came from. Without
    // this the report inlines the 136px capture beside a 104px reference and a
    // 104px heatmap, and stretches it to the reference's box under the slider.
    const ref = img(solid(104, 104), 104, 104);
    const cand = img(guttered([104, 104], 16), 136, 136, even(16));

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.candidatePng).toBeDefined();
    const out = PNG.sync.read(Buffer.from(r.candidatePng!));
    expect([out.width, out.height]).toEqual([104, 104]);
    // Cropped to the component, not merely resized: the gutter was transparent,
    // so every surviving pixel is the opaque block.
    expect(out.data[3]).toBe(0xff);
    expect(out.data[out.data.length - 1]).toBe(0xff);
  });

  it("omits the cropped candidate when nothing was cropped", async () => {
    // Absence is load-bearing — it tells a consumer the file on disk IS what was
    // compared. An undeclared gutter and an unusable declaration both mean that.
    const ref = img(solid(104, 104), 104, 104);
    const plain = img(solid(104, 104), 104, 104);
    expect(
      (await diffImagePair("/nonexistent", ref, plain, defaultDiffConfig)).candidatePng,
    ).toBeUndefined();

    // A gutter that would leave nothing behind degrades to the old comparison.
    const absurd = img(solid(104, 104), 104, 104, even(80));
    expect(
      (await diffImagePair("/nonexistent", ref, absurd, defaultDiffConfig)).candidatePng,
    ).toBeUndefined();
  });
});
