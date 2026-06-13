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
  /**
   * The standalone diff heatmap PNG (just the pixelmatch panel), for consumers
   * that lay out their own reference/candidate columns — e.g. the HTML report
   * (#50). Absent when there was no aligned region to diff (a beyond-tolerance
   * dimension mismatch).
   */
  diffPng?: Buffer;
  /**
   * True when reference and candidate had different dimensions but within
   * {@link DiffConfig.visualDimTolerancePx}, so they were diffed over their
   * top-left overlap rather than scored a total mismatch (#47).
   */
  dimensionMismatch?: boolean;
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

/** Decode a `data:<mediatype>;base64,<payload>` URI to its raw bytes. */
function decodeDataUri(uri: string): Buffer {
  const comma = uri.indexOf(",");
  const meta = comma === -1 ? "" : uri.slice("data:".length, comma);
  if (!/;base64$/i.test(meta)) {
    throw new Error(`visual: unsupported data: URI (expected base64): ${meta}`);
  }
  return Buffer.from(uri.slice(comma + 1), "base64");
}

async function readRaster(repoRoot: string, uri: string): Promise<Raster> {
  // A source may hand us the PNG inline as a `data:` URI (e.g. a `.zip` bundle,
  // which has no standalone repo file); decode it rather than reading from disk.
  const buf = uri.startsWith("data:")
    ? decodeDataUri(uri)
    : await readFile(resolve(repoRoot, uri));
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

  const dw = Math.abs(ref.width - cand.width);
  const dh = Math.abs(ref.height - cand.height);
  const sameSize = dw === 0 && dh === 0;
  // A sub-tolerance dimension delta (e.g. density rounding between two render
  // tools) is diffed over the shared top-left overlap rather than written off as
  // a total mismatch, so the real content drift isn't masked (#47).
  const aligned =
    !sameSize &&
    dw <= config.visualDimTolerancePx &&
    dh <= config.visualDimTolerancePx;

  // Score against the union box so the non-overlapping border (counted as
  // differing below) can't push the ratio past 1; for equal sizes this is just
  // the shared area.
  const totalPixels = Math.max(ref.width, cand.width) * Math.max(ref.height, cand.height);
  let diffPixels: number;
  let diff: Raster | null = null;
  let diffPng: Buffer | undefined;

  if (sameSize || aligned) {
    const ow = Math.min(ref.width, cand.width);
    const oh = Math.min(ref.height, cand.height);
    const out = new PNG({ width: ow, height: oh });
    const overlapDiff = pixelmatch(
      cropTopLeft(ref, ow, oh),
      cropTopLeft(cand, ow, oh),
      out.data,
      ow,
      oh,
      { threshold: config.pixelThreshold },
    );
    diff = { width: ow, height: oh, data: out.data };
    diffPng = PNG.sync.write(out);
    // Differing overlap pixels + the border only one image covers.
    diffPixels = overlapDiff + (totalPixels - ow * oh);
  } else {
    // Dimension drift beyond tolerance is a genuine total mismatch; there's no
    // meaningful aligned region to render.
    diffPixels = totalPixels;
  }

  const score = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const triptych = composeTriptych([ref, cand, diff]);

  const result: VisualResult = { key, score, diffPixels, totalPixels, triptych };
  if (diffPng) result.diffPng = diffPng;
  if (aligned) result.dimensionMismatch = true;
  return result;
}

/**
 * Copy the top-left `w×h` region of a raster into a fresh, tightly-packed RGBA
 * buffer (pixelmatch needs both inputs at one common stride). A no-op when the
 * region already spans the whole raster.
 */
function cropTopLeft(src: Raster, w: number, h: number): Buffer {
  if (src.width === w && src.height === h) return src.data;
  const out = Buffer.alloc(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const srcStart = y * src.width * 4;
    src.data.copy(out, y * rowBytes, srcStart, srcStart + rowBytes);
  }
  return out;
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
