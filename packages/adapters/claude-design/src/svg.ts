/**
 * Minimal, dependency-free SVG dimension reader.
 *
 * A committed reference may ship as vector SVG rather than a rasterised PNG (so
 * it renders crisp at any zoom in the report). Like {@link readPngSize}, the
 * adapter derives the image's `width`/`height` from the bytes on disk rather
 * than the handoff manifest — here from the root `<svg>`'s `width`/`height`
 * attributes, falling back to its `viewBox` extent.
 */
import { readFile } from "node:fs/promises";

export interface SvgSize {
  width: number;
  height: number;
}

/**
 * Read an SVG's intrinsic dimensions from disk.
 *
 * @throws if the file is missing or carries no usable size.
 */
export async function readSvgSize(path: string): Promise<SvgSize> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`claude-design: cannot read reference image '${path}'`, {
      cause,
    });
  }
  return parseSvgSize(text, path);
}

/** A finite length in CSS px, or `undefined` when absent / non-px (`%`, `em`, …). */
function pxLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  // Accept a bare number or an explicit `px`; reject `%`/`em`/`rem`/etc., which
  // aren't an intrinsic pixel size we can diff against.
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an SVG's pixel dimensions from its markup. Explicit `width`/`height`
 * win; otherwise the `viewBox`'s width/height (its 3rd and 4th numbers) supply
 * the intrinsic extent. Dimensions round to whole pixels to match the PNG path.
 *
 * @throws if there's no `<svg>` root or no usable size.
 */
export function parseSvgSize(text: string, label = "<buffer>"): SvgSize {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) {
    throw new Error(`claude-design: '${label}' is not an SVG image`);
  }
  const tag = open[0];
  const attr = (name: string): string | undefined =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];

  let width = pxLength(attr("width"));
  let height = pxLength(attr("height"));

  if (width === undefined || height === undefined) {
    const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      width ??= vb[2];
      height ??= vb[3];
    }
  }

  const w = width !== undefined ? Math.round(width) : 0;
  const h = height !== undefined ? Math.round(height) : 0;
  if (w <= 0 || h <= 0) {
    throw new Error(`claude-design: '${label}' has no usable SVG dimensions`);
  }
  return { width: w, height: h };
}
