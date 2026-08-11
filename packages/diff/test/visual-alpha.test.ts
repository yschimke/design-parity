import { describe, expect, it } from "vitest";

import type { CandidateRender, DesignReference, Image } from "@design-parity/core";
import { PNG } from "pngjs";

import { defaultDiffConfig } from "../src/config.js";
import { diff } from "../src/diff.js";
import { diffImagePair } from "../src/visual.js";

function alphaPng(width: number, height: number, alphas: number[]): string {
  const png = new PNG({ width, height });
  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    png.data[i] = 0x40;
    png.data[i + 1] = 0x80;
    png.data[i + 2] = 0xc0;
    png.data[i + 3] = alphas[pixel] ?? 0xff;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function img(uri: string, width: number, height: number): Image {
  return { state: "default", theme: "light", uri, width, height };
}

describe("directional alpha-loss visual diagnostic (#319)", () => {
  it("counts reference-opaque pixels whose candidate is transparent", async () => {
    const reference = img(alphaPng(2, 2, [255, 255, 255, 255]), 2, 2);
    const candidate = img(alphaPng(2, 2, [0, 0, 255, 255]), 2, 2);

    const result = await diffImagePair(
      "/nonexistent",
      reference,
      candidate,
      defaultDiffConfig,
    );

    expect(result.alphaLossPixels).toBe(2);
    expect(result.alphaComparedPixels).toBe(4);
    expect(result.alphaLossRatio).toBe(0.5);
  });

  it("does not count the reverse direction", async () => {
    const reference = img(alphaPng(2, 2, [0, 0, 255, 255]), 2, 2);
    const candidate = img(alphaPng(2, 2, [255, 255, 255, 255]), 2, 2);

    const result = await diffImagePair(
      "/nonexistent",
      reference,
      candidate,
      defaultDiffConfig,
    );

    expect(result.alphaLossPixels).toBe(0);
    expect(result.alphaLossRatio).toBe(0);
  });

  it("measures only the aligned overlap when dimensions differ", async () => {
    const reference = img(alphaPng(3, 2, [255, 255, 255, 255, 255, 255]), 3, 2);
    const candidate = img(alphaPng(2, 2, [0, 255, 255, 255]), 2, 2);

    const result = await diffImagePair(
      "/nonexistent",
      reference,
      candidate,
      defaultDiffConfig,
    );

    expect(result.dimensionMismatch).toBe(true);
    expect(result.alphaLossPixels).toBe(1);
    expect(result.alphaComparedPixels).toBe(4);
    expect(result.alphaLossRatio).toBe(0.25);
  });

  it("emits an advisory visual finding above the configured ratio", async () => {
    const referenceImage = img(alphaPng(2, 2, [255, 255, 255, 255]), 2, 2);
    const candidateImage = img(alphaPng(2, 2, [0, 0, 255, 255]), 2, 2);
    const reference: DesignReference = {
      componentId: "ui/Modal.kt#Modal",
      source: "bundle",
      linkMethod: "manifest",
      ref: "modal",
      referenceImages: [referenceImage],
    };
    const candidate: CandidateRender = {
      componentId: reference.componentId,
      images: [candidateImage],
      semantics: { theme: "light", root: { role: "dialog" } },
    };

    const { verdict } = await diff(reference, candidate);
    const finding = verdict.findings.find(
      (item) =>
        item.kind === "visual" && item.detail?.alphaLossRatio !== undefined,
    );

    expect(finding).toMatchObject({
      severity: "warn",
      detail: {
        alphaLossRatio: 0.5,
        alphaLossPixels: 2,
        alphaComparedPixels: 4,
      },
    });
    expect(finding?.message).toContain("opaque in the reference but transparent");
  });
});
