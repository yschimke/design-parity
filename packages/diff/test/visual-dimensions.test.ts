import { describe, it, expect } from "vitest";

import type { CandidateRender, DesignReference, Image } from "@design-parity/core";
import { PNG } from "pngjs";

import { diff } from "../src/index.js";
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

function img(uri: string, width: number, height: number): Image {
  return { state: "default", theme: "light", uri, width, height };
}

describe("diffImagePair dimension tolerance (#47)", () => {
  it("diffs a sub-tolerance size delta over the overlap instead of a 100% mismatch", async () => {
    // Same colour, 490x112 vs 492x112 — the exact 2px density-rounding gap from
    // the trial. Pre-fix this scored 1.0 (total mismatch) with an empty diff.
    const ref = img(solidPng(490, 112), 490, 112);
    const cand = img(solidPng(492, 112), 492, 112);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBe(true);
    // Only the 2px border column differs; the overlap matches exactly.
    expect(r.totalPixels).toBe(492 * 112);
    expect(r.diffPixels).toBe(2 * 112);
    expect(r.score).toBeCloseTo((2 * 112) / (492 * 112), 6);
    expect(r.score).toBeLessThan(0.01);
    // A real heatmap is rendered (the triptych is a valid PNG).
    expect(r.triptych.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("still flags the real content drift that a size delta used to mask", async () => {
    // Different colours + a 2px size gap: the content difference now surfaces.
    const ref = img(solidPng(200, 100, [0x20, 0x20, 0x20]), 200, 100);
    const cand = img(solidPng(202, 100, [0xe0, 0xe0, 0xe0]), 202, 100);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBe(true);
    // ~all overlap pixels differ (colour) plus the border — close to total, but
    // measured, not a blind 100%.
    expect(r.score).toBeGreaterThan(0.9);
  });

  it("diffs a beyond-tolerance size delta over the overlap instead of a blind 100%", async () => {
    const ref = img(solidPng(200, 100), 200, 100);
    const cand = img(solidPng(260, 100), 260, 100); // 60px, far past the 8px tolerance

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBe(true);
    // The overlap is identical; only the 60px border the candidate alone covers
    // differs. Pre-fix this was a flat 1.0 with no heatmap.
    expect(r.totalPixels).toBe(260 * 100);
    expect(r.borderPixels).toBe(60 * 100);
    expect(r.diffPixels).toBe(60 * 100);
    expect(r.score).toBeCloseTo((60 * 100) / (260 * 100), 6);
    expect(r.score).not.toBe(1);
    expect(r.diffPng).toBeDefined();
  });

  it("measures the DeviceBody vertical drift instead of saturating (the 8px cliff)", async () => {
    // The real meshcore-mobile shape: the candidate matches its design across
    // the full width and the first 2399 rows, then runs 48px taller. The whole
    // point of the pipeline is to report that as ~2% drift concentrated in the
    // height — the old cliff called it 100% and said nothing.
    const ref = img(solidPng(1078, 2399), 1078, 2399);
    const cand = img(solidPng(1078, 2447), 1078, 2447);

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBe(true);
    expect(r.dimensions).toEqual({
      reference: { width: 1078, height: 2399 },
      candidate: { width: 1078, height: 2447 },
    });
    // Every differing pixel is border: the content itself matches exactly.
    expect(r.borderPixels).toBe(1078 * 48);
    expect(r.diffPixels).toBe(r.borderPixels);
    expect(r.score).toBeLessThan(0.02);
  });

  // The remaining total-mismatch path (an empty overlap) isn't exercised here:
  // a zero-width/zero-height raster can't be built with pngjs, and no real
  // decoder produces one. The guard in `diffImagePair` stays as a defensive
  // floor so a degenerate rasterisation can't divide by an empty region.

  it("uses visualDimTolerancePx to grade the report, not to gate the diff", async () => {
    const ref = img(solidPng(200, 100), 200, 100);
    const cand = img(solidPng(210, 100), 210, 100); // 10px

    const tight = await diffImagePair("/x", ref, cand, defaultDiffConfig);
    const loose = await diffImagePair("/x", ref, cand, {
      ...defaultDiffConfig,
      visualDimTolerancePx: 16,
    });

    // Same measurement either way — the threshold no longer changes the score.
    expect(tight.dimensionMismatch).toBe(true);
    expect(loose.dimensionMismatch).toBe(true);
    expect(tight.score).toBe(loose.score);
  });

  it("surfaces an info finding through diff() when sizes are tolerated", async () => {
    const uri490 = solidPng(490, 112);
    const uri492 = solidPng(492, 112);
    const reference: DesignReference = {
      componentId: "ui/Tile.kt#LightOn",
      source: "bundle",
      linkMethod: "manifest",
      ref: "tile",
      referenceImages: [img(uri492, 492, 112)],
    };
    const candidate: CandidateRender = {
      componentId: "ui/Tile.kt#LightOn",
      images: [img(uri490, 490, 112)],
      semantics: { theme: "light", root: { role: "image" } },
    };

    const { verdict } = await diff(reference, candidate);
    const info = verdict.findings.find(
      (f) => f.kind === "visual" && f.severity === "info",
    );
    expect(info?.message).toContain("differ slightly in size");
  });

  it("warns with both frame sizes when the delta is a real size difference", async () => {
    const reference: DesignReference = {
      componentId: "ui/Tile.kt#LightOn",
      source: "bundle",
      linkMethod: "manifest",
      ref: "tile",
      referenceImages: [img(solidPng(200, 100), 200, 100)],
    };
    const candidate: CandidateRender = {
      componentId: "ui/Tile.kt#LightOn",
      images: [img(solidPng(260, 100), 260, 100)],
      semantics: { theme: "light", root: { role: "image" } },
    };

    const { verdict } = await diff(reference, candidate);
    const dim = verdict.findings.find(
      (f) => f.kind === "visual" && String(f.message).includes("overlap"),
    );
    expect(dim?.severity).toBe("warn");
    expect(dim?.message).toContain("200×100");
    expect(dim?.message).toContain("260×100");
    // The overlap matched, so none of the difference is content drift.
    expect(dim?.detail).toMatchObject({ dw: -60, dh: 0, contentPixels: 0 });
  });
});
