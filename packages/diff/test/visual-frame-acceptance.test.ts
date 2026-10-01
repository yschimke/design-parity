import { describe, it, expect, vi } from "vitest";

import type { Image } from "@design-parity/core";
import { PNG } from "pngjs";

const evaluate = vi.hoisted(() => vi.fn(() => undefined));
vi.mock("../src/acceptance/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/acceptance/index.js")>()),
  evaluateKnownDifferenceComparison: evaluate,
}));

const { diffImagePair } = await import("../src/visual.js");
const { defaultDiffConfig } = await import("../src/config.js");

/** A `w×h` opaque block at (`x`, `y`) on a transparent `cw×ch` canvas. */
function onCanvas(
  cw: number,
  ch: number,
  w: number,
  h: number,
  x: number,
  y: number,
): Image {
  const png = new PNG({ width: cw, height: ch });
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const i = (py * cw + px) * 4;
      png.data[i + 3] =
        px >= x && px < x + w && py >= y && py < y + h ? 0xff : 0x00;
    }
  }
  const uri = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
  return { state: "default", theme: "light", uri, width: cw, height: ch };
}

const scope = {
  system: "s",
  component: "c",
  previewId: "p",
  referenceId: "r",
  variant: "v",
  overrides: {},
};

describe("candidate frame crop and the semantics index (design-parity#504 review)", () => {
  const tight = onCanvas(104, 52, 104, 52, 0, 0);
  const framed = onCanvas(227, 100, 104, 52, 12, 30);
  const tagIndex = {
    label: { count: 1, bounds: { x: 20, y: 40, width: 30, height: 10 } },
    untracked: { count: 2 },
  };

  it("moves the tag bounds with the cropped origin", async () => {
    evaluate.mockClear();
    await diffImagePair(
      "/nonexistent",
      tight,
      framed,
      { ...defaultDiffConfig, visualCandidateFrame: "crop-to-content" },
      { repoRoot: "/nonexistent", scope, tagIndex },
    );
    const passed = evaluate.mock.calls[0]![0] as { tagIndex: typeof tagIndex };
    expect({ ...passed.tagIndex }).toEqual({
      label: { count: 1, bounds: { x: 8, y: 10, width: 30, height: 10 } },
      untracked: { count: 2 },
    });
  });

  it("hands the index through untouched when nothing was cropped", async () => {
    evaluate.mockClear();
    await diffImagePair("/nonexistent", tight, framed, defaultDiffConfig, {
      repoRoot: "/nonexistent",
      scope,
      tagIndex,
    });
    const passed = evaluate.mock.calls[0]![0] as { tagIndex: typeof tagIndex };
    expect(passed.tagIndex).toBe(tagIndex);
  });

  it("treats an absent visualCandidateFrame as keep", async () => {
    const { visualCandidateFrame: _, ...withoutField } = defaultDiffConfig;
    const r = await diffImagePair("/nonexistent", tight, framed, withoutField);
    expect(r.candidatePng).toBeUndefined();
    expect(r.dimensionMismatch).toBe(true);
  });
});
