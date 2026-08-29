/**
 * Normalise Figma's empty-image placeholder in a cached reference SVG.
 *
 * A Figma `IMAGE` fill with no image behind it renders as Figma's checkerboard,
 * and caching that verbatim makes the reference a bad measuring instrument. A
 * checkerboard converts a SMALL geometry error into a LARGE pixel difference and
 * then stops responding: measured over a 236x132 region against the kit's own
 * grid, a 1dp shift reports 6.8% of pixels differing where a flat fill reports
 * 0.8%, a 3dp shift 20.3% against 2.5%, and a 10dp shift 67.8% against 8.5% —
 * by which point it is indistinguishable from a component that is entirely
 * wrong. Worse, two checkerboards at different PITCHES differ in ~50% of pixels
 * however small the underlying error, because the grids decorrelate. A consumer
 * whose slot is 42dp against the kit's 64dp scores the same as one drawing
 * nothing at all.
 *
 * So the paint is replaced and nothing else. The path keeps its geometry —
 * position, size, corner radius, the clip it sits in — so the shape is still
 * fully compared and a wrong frame still diffs, in proportion to how wrong it
 * is. This is the opposite of masking the region, which would answer the
 * saturation problem by discarding the measurement.
 *
 * The reference then no longer matches what Figma renders for those nodes. That
 * is the trade, and it is why every rewrite is reported per node rather than
 * applied silently.
 */
import { createHash } from "node:crypto";

import { PNG } from "pngjs";

/**
 * What to paint where the kit left an image slot empty.
 *
 * `flat` is the default because it is the only option whose reported difference
 * stays monotonic across the whole error range. A bordered, transparent box is
 * the mirror failure of the checkerboard: sensitive at 1dp (2.5%) but flat by
 * 10dp (4.4%), because once the two outlines separate the difference stops
 * growing.
 */
export type PlaceholderFill =
  | "flat"
  | "checkerboard"
  | "transparent"
  /** An explicit `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
  | `#${string}`;

/** One placeholder the normaliser replaced, for the import's log. */
export interface PlaceholderRewrite {
  /** `<image>` element id carrying the tile. */
  imageId: string;
  /** Pattern ids that painted with it, and so the fills that were rewritten. */
  patternIds: string[];
  /** Tile checksum, so a kit whose placeholder changes is identifiable. */
  sha256: string;
  /** The tile's two colours, as `#rrggbb`. */
  colors: [string, string];
  /** What was painted instead: a colour, or `none` for transparent. */
  paint: string;
}

export interface NormaliseResult {
  svg: string;
  rewrites: PlaceholderRewrite[];
}

/**
 * The fewest bands per axis worth calling a checkerboard.
 *
 * A two-colour image is not remarkable — a mask, a duotone icon and a
 * half-and-half swatch are all two colours. Requiring a repeating grid is what
 * separates Figma's placeholder from artwork that happens to be flat.
 */
const MIN_BANDS = 4;

/** Largest tile worth decoding. Figma's is 400x400; artwork is far bigger. */
const MAX_TILE = 1024;

const IMAGE_ELEMENT =
  /<image\s+id="([^"]+)"[^>]*?\swidth="(\d+)"\s+height="(\d+)"[^>]*?xlink:href="data:image\/png;base64,([^"]+)"[^>]*\/>/g;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Band boundaries along one axis, or null where the runs are not uniform.
 *
 * Figma's own tile does not start its grid at its edge — the bands break at
 * 26px then every 50px in a 400px image — so the first and last runs are
 * allowed to be short and only the interior ones have to agree.
 */
function bands(at: (i: number) => number, length: number): number[] | null {
  const edges: number[] = [];
  for (let i = 1; i < length; i++) if (at(i) !== at(i - 1)) edges.push(i);
  if (edges.length + 1 < MIN_BANDS) return null;
  const interior: number[] = [];
  for (let i = 1; i < edges.length; i++) interior.push(edges[i]! - edges[i - 1]!);
  if (interior.length === 0) return null;
  const first = interior[0]!;
  if (first <= 0) return null;
  if (interior.some((run) => run !== first)) return null;
  // The leading and trailing partial runs must fit inside one full band, or
  // this is a stripe pattern with an unrelated margin rather than a grid.
  if (edges[0]! > first || length - edges[edges.length - 1]! > first) return null;
  return edges;
}

/**
 * Is this tile a regular two-colour checkerboard?
 *
 * Structural rather than a checksum list: Figma is free to change the asset,
 * and a kit is free to ship its own. The checksum is reported, not matched on.
 */
export function isCheckerboard(png: PNG): { colors: [string, string] } | null {
  const { width, height, data } = png;
  if (width < MIN_BANDS || height < MIN_BANDS) return null;
  if (width > MAX_TILE || height > MAX_TILE) return null;

  const seen = new Map<number, [number, number, number]>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a !== 255) return null; // A translucent tile is not the placeholder.
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    if (!seen.has(key)) {
      if (seen.size === 2) return null;
      seen.set(key, [r, g, b]);
    }
  }
  if (seen.size !== 2) return null;

  const keys = [...seen.keys()];
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return ((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!) === keys[0] ? 0 : 1;
  };

  const mid = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const cols = bands((i) => at(i, mid.y), width);
  const rows = bands((i) => at(mid.x, i), height);
  if (!cols || !rows) return null;

  // Every pixel must agree with the grid the two mid-lines imply. A tile that
  // is two colours in regular bands but not ALTERNATING them — vertical stripes
  // — fails here rather than being normalised away.
  const pitchX = cols.length > 1 ? cols[1]! - cols[0]! : width;
  const pitchY = rows.length > 1 ? rows[1]! - rows[0]! : height;
  const originX = cols[0]! - pitchX;
  const originY = rows[0]! - pitchY;
  const base = at(0, 0);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y - originY) / pitchY);
    for (let x = 0; x < width; x++) {
      const col = Math.floor((x - originX) / pitchX);
      const expected = (row + col) % 2 === 0 ? base : 1 - base;
      if (at(x, y) !== expected) return null;
    }
  }

  const [c0, c1] = keys.map((k) => seen.get(k)!);
  return { colors: [hex(...(c0 as [number, number, number])), hex(...(c1 as [number, number, number]))] };
}

/** The mean of the tile's two colours — the checkerboard, blurred. */
function meanColor(a: string, b: string): string {
  const part = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return hex(
    Math.round((part(a, 0) + part(b, 0)) / 2),
    Math.round((part(a, 1) + part(b, 1)) / 2),
    Math.round((part(a, 2) + part(b, 2)) / 2),
  );
}

/**
 * Replace every empty-image placeholder in `svg` with `fill`.
 *
 * Returns the SVG unchanged, with no rewrites, when `fill` is `checkerboard` or
 * the document carries no placeholder — so a caller can apply it unconditionally.
 */
export function normalisePlaceholders(svg: string, fill: PlaceholderFill): NormaliseResult {
  if (fill === "checkerboard") return { svg, rewrites: [] };

  const tiles = new Map<string, { sha256: string; colors: [string, string] }>();
  for (const match of svg.matchAll(IMAGE_ELEMENT)) {
    const [, id, , , b64] = match;
    let png: PNG;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64!, "base64");
      png = PNG.sync.read(bytes);
    } catch {
      continue; // Not a PNG we can read is not a placeholder we can identify.
    }
    const checker = isCheckerboard(png);
    if (!checker) continue;
    tiles.set(id!, {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      colors: checker.colors,
    });
  }
  if (tiles.size === 0) return { svg, rewrites: [] };

  // Which patterns paint with those tiles. A pattern wraps a <use> of the
  // <image>, and a path names the pattern — so the fill is two hops from the
  // pixels, and both have to be walked to reach it.
  const byImage = new Map<string, string[]>();
  for (const match of svg.matchAll(/<pattern\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/pattern>/g)) {
    const [, patternId, body] = match;
    for (const use of body!.matchAll(/xlink:href="#([^"]+)"/g)) {
      const imageId = use[1]!;
      if (!tiles.has(imageId)) continue;
      byImage.set(imageId, [...(byImage.get(imageId) ?? []), patternId!]);
    }
  }

  const rewrites: PlaceholderRewrite[] = [];
  let out = svg;
  for (const [imageId, tile] of tiles) {
    const patternIds = byImage.get(imageId) ?? [];
    if (patternIds.length === 0) continue; // Cached but unpainted: leave it be.
    const paint =
      fill === "transparent"
        ? "none"
        : fill === "flat"
          ? meanColor(tile.colors[0], tile.colors[1])
          : fill;
    for (const patternId of patternIds) {
      out = out.split(`url(#${patternId})`).join(paint);
      // The pattern and its tile are now unreferenced, and the tile is the bulk
      // of the file — a 400x400 PNG per placeholder, base64'd.
      out = out.replace(
        new RegExp(`<pattern\\s+id="${escapeId(patternId)}"[^>]*>[\\s\\S]*?</pattern>\\n?`),
        "",
      );
    }
    out = out.replace(
      new RegExp(`<image\\s+id="${escapeId(imageId)}"[^>]*?/>\\n?`),
      "",
    );
    rewrites.push({ imageId, patternIds, sha256: tile.sha256, colors: tile.colors, paint });
  }

  return { svg: out, rewrites };
}

const escapeId = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
