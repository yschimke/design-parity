/**
 * Visual diff: per-pixel comparison + the reference/candidate/diff triptych.
 *
 * pixelmatch gives a deterministic differing-pixel count (Principle 1); the
 * triptych is a single PNG that stacks reference, candidate, and the pixelmatch
 * heatmap side by side so a reviewer sees what moved. Visual diff is table
 * stakes (Principle 2) — it informs, it never gates.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeSize, type Image, type ImageGutter } from "@design-parity/core";
import { Resvg } from "@resvg/resvg-js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import type { DiffConfig } from "./config.js";
import {
  evaluateKnownDifferenceComparison,
  type AcceptanceReport,
  type AcceptanceScope,
  type TagIndex,
} from "./acceptance/index.js";

const GAP = 8;
const GAP_RGBA: [number, number, number, number] = [0x1f, 0x1f, 0x24, 0xff];

interface Raster {
  width: number;
  height: number;
  data: Buffer;
  /** SHA-256 of the source artifact bytes, before any SVG rasterisation. */
  sourceSha256?: string;
}

/** The result of comparing one reference image against its candidate twin. */
export interface VisualResult {
  /** `state/theme/size` key shared with {@link Verdict.visualScores}. */
  key: string;
  /** Fraction of differing pixels, 0 (identical) … 1. */
  score: number;
  diffPixels: number;
  totalPixels: number;
  /** Reference-opaque pixels whose aligned candidate pixel is transparent. */
  alphaLossPixels?: number;
  /** Number of overlap pixels inspected for directional alpha loss. */
  alphaComparedPixels?: number;
  /** `alphaLossPixels / alphaComparedPixels`, when the pair can be aligned. */
  alphaLossRatio?: number;
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
   * The candidate PNG as actually compared — with its declared
   * {@link Image.gutter} cropped off. Present ONLY when a gutter was really
   * subtracted, so absence means "the file on disk is what was compared".
   *
   * A consumer laying out its own candidate column has to show this rather than
   * the candidate `uri`, or it contradicts the score it is printing: the file on
   * disk is the guttered capture, so a reader sees a 136px candidate beside a
   * 104px reference and a 104px heatmap, and an overlay slider stretches the
   * guttered image to the reference's box — reintroducing, in the one view a
   * human actually reviews, exactly the misalignment the crop removed.
   */
  candidatePng?: Buffer;
  /**
   * True when reference and candidate had different dimensions. They are still
   * diffed over their shared top-left overlap; the score counts the uncovered
   * border as differing (#47).
   */
  dimensionMismatch?: boolean;
  /**
   * The raster dimensions actually compared, present only when they differ.
   * Lets a consumer name the drift ("reference 1078×2399 vs candidate
   * 1078×2447") instead of just reporting a ratio.
   */
  dimensions?: {
    reference: { width: number; height: number };
    candidate: { width: number; height: number };
  };
  /**
   * Pixels of the union box that only one side covers — the part of the score
   * attributable to the *size* difference rather than to content drift. A
   * reviewer reads `borderPixels === diffPixels` as "the overlap matches
   * exactly; the images are only different sizes".
   */
  borderPixels?: number;
  /** Scoped acceptance evaluation; raw visual scoring remains present above. */
  acceptance?: AcceptanceReport;
}

export interface VisualAcceptanceOptions {
  repoRoot: string;
  scope: AcceptanceScope;
  /** Absent when this exact image has no semantics; element gates are refused. */
  tagIndex?: TagIndex;
  documentPath?: string;
  artifactRoot?: string;
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

/**
 * Rasterisation scale for a vector reference when the candidate's width isn't
 * known (candidate is itself vector, or it failed to decode). A 2× render
 * mirrors the Figma adapter's original `scale=2` PNG export.
 *
 * The *normal* path does not use this — see {@link rasterizeSvg}. A vector
 * reference is resolution-free, so rasterising it at a fixed multiple of its own
 * user units only lines up with the candidate by luck: a Figma frame authored in
 * dp rasterises to 2× a 2.625×-density Compose render (822px vs 1078px), and a
 * frame seeded from an already-device-pixel export rasterises to exactly twice
 * it. Either way the two sides land at wildly different sizes and the score
 * degenerates into "the images are different shapes" — a number that says
 * nothing about the design.
 */
const SVG_RASTER_SCALE = 2;

/** Whether the bytes are a PNG (magic `89 50 4E 47`); anything else is SVG markup. */
function isPng(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/**
 * Rasterise an SVG reference so the pixel diff (which is inherently raster) can
 * compare it. resvg is deterministic — same markup in, same pixels out — and
 * self-contained (no headless browser). The report itself still shows the SVG
 * as crisp vector; this bitmap exists only for pixelmatch.
 *
 * Rendered to `targetWidth` — the candidate raster's width — so the two sides
 * meet at the same density whatever units the design was authored in. That is
 * what makes a vector reference comparable at all: the diff wants pixel drift
 * (colour, spacing, glyphs), not a report that the design tool and the renderer
 * disagree about how big a dp is. Falls back to {@link SVG_RASTER_SCALE} when
 * there is no candidate width to match.
 */
function rasterizeSvg(buf: Buffer, targetWidth?: number): Raster {
  const resvg = new Resvg(buf.toString("utf8"), {
    fitTo:
      targetWidth && targetWidth > 0
        ? { mode: "width", value: targetWidth }
        : { mode: "zoom", value: SVG_RASTER_SCALE },
    font: { loadSystemFonts: true },
  });
  const img = resvg.render();
  return { width: img.width, height: img.height, data: Buffer.from(img.pixels) };
}

async function readRaster(
  repoRoot: string,
  uri: string,
  targetWidth?: number,
): Promise<Raster> {
  // A source may hand us the image inline as a `data:` URI (e.g. a `.zip` bundle,
  // which has no standalone repo file); decode it rather than reading from disk.
  const buf = uri.startsWith("data:")
    ? decodeDataUri(uri)
    : await readFile(resolve(repoRoot, uri));
  const sourceSha256 = createHash("sha256").update(buf).digest("hex");
  // A committed reference may be vector SVG (crisp in the report); rasterise it
  // so pixelmatch has a bitmap. PNGs (every candidate render) decode directly.
  if (!isPng(buf)) {
    return { ...rasterizeSvg(buf, targetWidth), sourceSha256 };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data, sourceSha256 };
}

/**
 * Trim a declared capture gutter off a raster, leaving the component's own
 * bounds.
 *
 * This is a crop, not a tolerance. The gutter is stated by the renderer (see
 * {@link Image.gutter}) rather than detected, so nothing here guesses at
 * transparent margins: an image with no declared gutter is returned untouched,
 * and so is one whose gutter would leave nothing behind — a bad declaration
 * should degrade to the old comparison, never to a zero-sized one.
 */
export function cropGutter(img: Raster, gutter?: ImageGutter): Raster {
  if (!gutter) return img;
  const { start, top, end, bottom } = gutter;
  const width = img.width - start - end;
  const height = img.height - top - bottom;
  if (width <= 0 || height <= 0) return img;
  if (width === img.width && height === img.height) return img;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y + top) * img.width + start) * 4;
    img.data.copy(data, y * width * 4, from, from + width * 4);
  }
  return { width, height, data, sourceSha256: img.sourceSha256 };
}

/** Re-encode a raster as PNG bytes, for handing a compared image to a consumer. */
function rasterToPng(img: Raster): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}

/** Compare one matched pair, returning its score and triptych. */
export async function diffImagePair(
  repoRoot: string,
  reference: Image,
  candidate: Image,
  config: DiffConfig,
  acceptance?: VisualAcceptanceOptions,
): Promise<VisualResult> {
  // Candidate first: a vector reference is rasterised to the candidate's width
  // (see `rasterizeSvg`), so the candidate's own size has to be known already.
  //
  // And it is the GUTTER-FREE width that matters. A declared `Image.gutter` is
  // transparent frame the renderer added, not content, so it comes off before
  // the reference is sized against it — otherwise the reference is rasterised
  // to a canvas wider than the component and every subsequent step compares at
  // the wrong zoom.
  const candRaw = await readRaster(repoRoot, candidate.uri);
  const cand = cropGutter(candRaw, candidate.gutter);
  const ref = await readRaster(repoRoot, reference.uri, cand.width);
  const key = imageKey(reference);

  const sameSize = ref.width === cand.width && ref.height === cand.height;

  // Score against the union box so the non-overlapping border (counted as
  // differing below) can't push the ratio past 1; for equal sizes this is just
  // the shared area.
  const totalPixels = Math.max(ref.width, cand.width) * Math.max(ref.height, cand.height);
  // The shared top-left region — the only part where comparing pixels means
  // anything. It is diffed *whatever* the size delta. Writing a large delta off
  // as a flat 100% threw away the answer along with the question: a candidate
  // that matches its design for 2399 rows and then runs 48px taller is ~2%
  // drift plus a border, and reporting it as "100% of pixels differ" hides both
  // the fact that the content matches and the fact that the height is what
  // moved. Only a genuinely empty overlap (a zero-width or zero-height side)
  // has nothing left to compare.
  const ow = Math.min(ref.width, cand.width);
  const oh = Math.min(ref.height, cand.height);
  const borderPixels = totalPixels - ow * oh;

  let diffPixels: number;
  let diff: Raster | null = null;
  let diffPng: Buffer | undefined;
  let alphaLossPixels: number | undefined;
  let alphaComparedPixels: number | undefined;
  let alphaLossRatio: number | undefined;

  if (ow > 0 && oh > 0) {
    const refOverlap = cropTopLeft(ref, ow, oh);
    const candOverlap = cropTopLeft(cand, ow, oh);
    const out = new PNG({ width: ow, height: oh });
    const overlapDiff = pixelmatch(
      refOverlap,
      candOverlap,
      out.data,
      ow,
      oh,
      { threshold: config.pixelThreshold },
    );
    diff = { width: ow, height: oh, data: out.data };
    diffPng = PNG.sync.write(out);
    // Differing overlap pixels + the border only one image covers.
    diffPixels = overlapDiff + borderPixels;
    alphaComparedPixels = ow * oh;
    alphaLossPixels = countDirectionalAlphaLoss(
      refOverlap,
      candOverlap,
      config.visualAlphaOpaqueThreshold,
      config.visualAlphaTransparentThreshold,
    );
    alphaLossRatio =
      alphaComparedPixels === 0 ? 0 : alphaLossPixels / alphaComparedPixels;
  } else {
    // No overlap at all (a zero-dimension side) — nothing to render or measure.
    diffPixels = totalPixels;
  }

  const score = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const triptych = composeTriptych([ref, cand, diff]);

  const result: VisualResult = { key, score, diffPixels, totalPixels, triptych };
  if (acceptance) {
    const evaluated = evaluateKnownDifferenceComparison({
      repoRoot: acceptance.repoRoot,
      scope: {
        ...acceptance.scope,
        referenceSha256: ref.sourceSha256 ?? null,
      },
      reference: { width: ref.width, height: ref.height, pixels: ref.data },
      candidate: { width: cand.width, height: cand.height, pixels: cand.data },
      tagIndex: acceptance.tagIndex,
      ...(acceptance.documentPath ? { documentPath: acceptance.documentPath } : {}),
      ...(acceptance.artifactRoot ? { artifactRoot: acceptance.artifactRoot } : {}),
    });
    if (evaluated) result.acceptance = evaluated;
  }
  if (diffPng) result.diffPng = diffPng;
  // Identity, not a dimension test: `cropGutter` returns its input untouched
  // when there is nothing to crop *and* when the declaration is unusable, so a
  // new object is exactly the case where the compared pixels are no longer the
  // ones on disk.
  if (cand !== candRaw) result.candidatePng = rasterToPng(cand);
  if (!sameSize) {
    result.dimensionMismatch = true;
    result.dimensions = {
      reference: { width: ref.width, height: ref.height },
      candidate: { width: cand.width, height: cand.height },
    };
    result.borderPixels = borderPixels;
  }
  if (alphaLossPixels !== undefined) result.alphaLossPixels = alphaLossPixels;
  if (alphaComparedPixels !== undefined) {
    result.alphaComparedPixels = alphaComparedPixels;
  }
  if (alphaLossRatio !== undefined) result.alphaLossRatio = alphaLossRatio;
  return result;
}

/** Count aligned pixels that lose an opaque reference surface entirely. */
function countDirectionalAlphaLoss(
  reference: Buffer,
  candidate: Buffer,
  opaqueThreshold: number,
  transparentThreshold: number,
): number {
  const opaqueAlpha = Math.round(opaqueThreshold * 0xff);
  const transparentAlpha = Math.round(transparentThreshold * 0xff);
  let count = 0;
  for (let i = 3; i < reference.length; i += 4) {
    if (reference[i]! >= opaqueAlpha && candidate[i]! <= transparentAlpha) {
      count++;
    }
  }
  return count;
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
