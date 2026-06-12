/**
 * Visual diff: per-pixel comparison + the reference/candidate/diff triptych.
 *
 * pixelmatch gives a deterministic differing-pixel count (Principle 1); the
 * triptych is a single PNG that stacks reference, candidate, and the pixelmatch
 * heatmap side by side so a reviewer sees what moved. Visual diff is table
 * stakes (Principle 2) — it informs, it never gates.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeSize, type Image } from "@design-parity/core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import type { DiffConfig } from "./config.js";

const GAP = 8;
const GAP_RGBA: [number, number, number, number] = [0x1f, 0x1f, 0x24, 0xff];

interface Raster {
  width: number;
  height: number;
  data: Buffer;
}

/** The result of comparing one reference image against its candidate twin. */
export interface VisualResult {
  /** `state/theme/size` key shared with {@link Verdict.visualScores}. */
  key: string;
  /** Fraction of differing pixels, 0 (identical) … 1. */
  score: number;
  diffPixels: number;
  totalPixels: number;
  /** Side-by-side reference | candidate | diff PNG. */
  triptych: Buffer;
}

/** Human-readable key (raw size) — also the {@link Verdict.visualScores} key. */
export function imageKey(img: Image): string {
  return [img.state, img.theme, img.size].filter(Boolean).join("/");
}

/** The size token used for pairing: canonical when recognized, else the raw label. */
function sizeToken(img: Image): string | undefined {
  return normalizeSize(img.size) ?? img.size?.toLowerCase();
}

/**
 * Pairing key with the size normalized, so `"Compact"` / `"compact"` / `"600dp"`
 * all match. Differs from {@link imageKey} (which keeps the raw label for humans).
 */
export function pairKey(img: Image): string {
  return [img.state, img.theme, sizeToken(img)].filter(Boolean).join("/");
}

/** Looser key ignoring size — used to pair when a side omits/uses an unknown size. */
export function looseKey(img: Image): string {
  return [img.state, img.theme].filter(Boolean).join("/");
}

/**
 * Whether two images may pair despite different size labels: compatible when at
 * least one side has no recognized size, or both canonicalize to the same one.
 * Two *different* known sizes (compact vs expanded) are genuinely distinct.
 */
export function sizeCompatible(a: Image, b: Image): boolean {
  const ca = normalizeSize(a.size);
  const cb = normalizeSize(b.size);
  return ca === undefined || cb === undefined || ca === cb;
}

async function readRaster(repoRoot: string, uri: string): Promise<Raster> {
  const buf = await readFile(resolve(repoRoot, uri));
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

/** Compare one matched pair, returning its score and triptych. */
export async function diffImagePair(
  repoRoot: string,
  reference: Image,
  candidate: Image,
  config: DiffConfig,
): Promise<VisualResult> {
  const ref = await readRaster(repoRoot, reference.uri);
  const cand = await readRaster(repoRoot, candidate.uri);
  const key = imageKey(reference);

  const sameSize = ref.width === cand.width && ref.height === cand.height;
  let diffPixels: number;
  let diff: Raster | null = null;

  if (sameSize) {
    const out = new PNG({ width: ref.width, height: ref.height });
    diffPixels = pixelmatch(ref.data, cand.data, out.data, ref.width, ref.height, {
      threshold: config.pixelThreshold,
    });
    diff = { width: ref.width, height: ref.height, data: out.data };
  } else {
    // Dimension drift is a total mismatch; there's no aligned diff to render.
    diffPixels = Math.max(ref.width * ref.height, cand.width * cand.height);
  }

  const totalPixels = ref.width * ref.height;
  const score = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const triptych = composeTriptych([ref, cand, diff]);

  return { key, score, diffPixels, totalPixels, triptych };
}

/** Lay panels out left-to-right on a gap-coloured strip, top-aligned. */
function composeTriptych(panels: Array<Raster | null>): Buffer {
  const present = panels.map(
    (p) => p ?? { width: 1, height: 1, data: Buffer.alloc(4) },
  );
  const height = Math.max(...present.map((p) => p.height));
  const width =
    present.reduce((sum, p) => sum + p.width, 0) + GAP * (present.length - 1);
  const out = new PNG({ width, height });

  // Fill with the gap colour so seams and short panels read as deliberate.
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = GAP_RGBA[0];
    out.data[i + 1] = GAP_RGBA[1];
    out.data[i + 2] = GAP_RGBA[2];
    out.data[i + 3] = GAP_RGBA[3];
  }

  let xOffset = 0;
  for (const panel of present) {
    blit(out, panel, xOffset);
    xOffset += panel.width + GAP;
  }
  return PNG.sync.write(out);
}

function blit(dest: PNG, src: Raster, xOffset: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const di = (y * dest.width + (x + xOffset)) * 4;
      dest.data[di] = src.data[si]!;
      dest.data[di + 1] = src.data[si + 1]!;
      dest.data[di + 2] = src.data[si + 2]!;
      dest.data[di + 3] = src.data[si + 3]!;
    }
  }
}
