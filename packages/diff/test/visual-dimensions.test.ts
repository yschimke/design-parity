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

  it("treats a beyond-tolerance size delta as a genuine total mismatch", async () => {
    const ref = img(solidPng(200, 100), 200, 100);
    const cand = img(solidPng(260, 100), 260, 100); // 60px > 8px tolerance

    const r = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(r.dimensionMismatch).toBeUndefined();
    expect(r.score).toBe(1);
    expect(r.diffPixels).toBe(r.totalPixels);
  });

  it("respects a custom visualDimTolerancePx override", async () => {
    const ref = img(solidPng(200, 100), 200, 100);
    const cand = img(solidPng(210, 100), 210, 100); // 10px

    const tight = await diffImagePair("/x", ref, cand, defaultDiffConfig);
    expect(tight.dimensionMismatch).toBeUndefined(); // 10 > default 8

    const loose = await diffImagePair("/x", ref, cand, {
      ...defaultDiffConfig,
      visualDimTolerancePx: 16,
    });
    expect(loose.dimensionMismatch).toBe(true); // 10 <= 16
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
});
