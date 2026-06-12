import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type { CandidateRender, DesignReference, Image } from "@design-parity/core";

import { diff } from "../src/index.js";
import { diffImagePair } from "../src/visual.js";
import { defaultDiffConfig } from "../src/config.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Build a `data:image/png;base64,…` URI from a committed fixture PNG. */
async function pngDataUri(relPath: string): Promise<string> {
  const bytes = await readFile(resolve(repoRoot, relPath));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const FIXTURE = "fixtures/figma/button-primary.light.png";

describe("readRaster honors data: URIs", () => {
  it("diffImagePair reads a data:-URI image and scores it (identical to itself)", async () => {
    const uri = await pngDataUri(FIXTURE);
    const ref: Image = { state: "default", uri, width: 160, height: 48 };
    const cand: Image = { state: "default", uri, width: 160, height: 48 };

    // repoRoot is irrelevant here — the bytes are inline, not on disk.
    const result = await diffImagePair("/nonexistent", ref, cand, defaultDiffConfig);

    expect(result.score).toBe(0);
    expect(result.totalPixels).toBe(160 * 48);
    // The triptych is a real PNG (magic number).
    expect(result.triptych.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("scores a data:-URI image against a different on-disk image as differing", async () => {
    const ref: Image = {
      state: "default",
      uri: await pngDataUri("fixtures/figma/button-primary.light.png"),
      width: 160,
      height: 48,
    };
    const cand: Image = {
      state: "default",
      uri: "fixtures/candidate/button-primary.dark.png",
      width: 160,
      height: 48,
    };
    const result = await diffImagePair(repoRoot, ref, cand, defaultDiffConfig);
    expect(result.score).toBeGreaterThan(0);
  });

  it("flows through diff() end-to-end with inline reference bytes", async () => {
    const uri = await pngDataUri(FIXTURE);
    const reference: DesignReference = {
      componentId: "ui/Card.kt#Inline",
      source: "bundle",
      linkMethod: "manifest",
      ref: "inline",
      referenceImages: [{ state: "default", theme: "light", uri, width: 160, height: 48 }],
    };
    const candidate: CandidateRender = {
      componentId: "ui/Card.kt#Inline",
      images: [{ state: "default", theme: "light", uri, width: 160, height: 48 }],
      semantics: {
        theme: "light",
        root: {
          role: "image",
          bounds: { x: 0, y: 0, width: 160, height: 48 },
        },
      },
    };

    // No repoRoot needed: both images are inline data: URIs.
    const { verdict } = await diff(reference, candidate);
    expect(verdict.visualScores?.["default/light"]).toBe(0);
  });
});
