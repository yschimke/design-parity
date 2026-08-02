/**
 * Pure preparation for the editable `compose/figma-svg` import.
 *
 * SVG is a useful interchange format, but a few valid SVG constructs make
 * Figma fall back to generic vector paths. This module keeps the visual result
 * while spelling those constructs in the form Figma can retain as native
 * rectangles, text, and Auto Layout geometry.
 */

/** One font face requested by an SVG text/tspan element. */
export interface SvgFontRequest {
  family: string;
  weight: number;
  italic: boolean;
}

/** A Figma font available to the plugin. */
export interface AvailableFont {
  family: string;
  style: string;
}

/** Geometry inferred for a conservative horizontal/vertical Auto Layout frame. */
export interface InferredAutoLayout {
  mode: "HORIZONTAL" | "VERTICAL";
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX";
  order: number[];
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A named theme token attached to an exported SVG group. */
export interface SvgTokenAnnotation {
  layer: string;
  token: string;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function attrs(tag: string): Map<string, { value: string; start: number; end: number; quote: string }> {
  const out = new Map<string, { value: string; start: number; end: number; quote: string }>();
  const re = /([:\w-]+)\s*=\s*(["'])(.*?)\2/gs;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    const whole = match[0]!;
    const value = match[3]!;
    const valueOffset = whole.indexOf(value);
    out.set(match[1]!.toLowerCase(), {
      value,
      start: match.index + valueOffset,
      end: match.index + valueOffset + value.length,
      quote: match[2]!,
    });
  }
  return out;
}

function scalar(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!NUMBER.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function radius(value: string, side: number): number | undefined {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percent = scalar(trimmed.slice(0, -1));
    return percent === undefined ? undefined : side * percent / 100;
  }
  return scalar(trimmed);
}

function compact(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/**
 * Clamp a rounded SVG rect's radius to the native rectangle range Figma uses.
 *
 * Browsers clamp an over-large radius at paint time, so exporters commonly
 * emit `rx="50%"` or `rx="width/2"` for a pill. Figma imports that visual as a
 * path. Resolving it to `min(width, height) / 2` is pixel-equivalent and keeps a
 * real RectangleNode with an editable corner radius. Elliptical corners are
 * deliberately left alone because a Figma rectangle cannot represent them
 * without changing the design.
 */
export function normalizeSvgRects(svg: string): string {
  return svg.replace(/<rect\b[^>]*>/gi, (tag) => {
    const parsed = attrs(tag);
    const width = scalar(parsed.get("width")?.value);
    const height = scalar(parsed.get("height")?.value);
    const rxAttr = parsed.get("rx");
    const ryAttr = parsed.get("ry");
    if (width === undefined || height === undefined || width < 0 || height < 0 || !rxAttr) {
      return tag;
    }

    const rx = radius(rxAttr.value, width);
    const ry = radius(ryAttr?.value ?? rxAttr.value, height);
    if (rx === undefined || ry === undefined) return tag;
    const limit = Math.max(0, Math.min(width, height) / 2);
    const clampedX = Math.min(Math.max(0, rx), limit);
    const clampedY = Math.min(Math.max(0, ry), limit);
    // Preserve a genuinely elliptical corner. The pill/circle case converges
    // to one radius after clamping and can therefore stay a native rectangle.
    if (Math.abs(clampedX - clampedY) > 0.001) return tag;

    const replacements = [
      { attr: rxAttr, value: compact(clampedX) },
      ...(ryAttr ? [{ attr: ryAttr, value: compact(clampedY) }] : []),
    ].sort((a, b) => b.attr.start - a.attr.start);
    let out = tag;
    for (const replacement of replacements) {
      out = out.slice(0, replacement.attr.start) + replacement.value + out.slice(replacement.attr.end);
    }
    return out;
  });
}

function firstFamily(value: string): string | undefined {
  const family = value.split(",", 1)[0]?.trim().replace(/^['"]|['"]$/g, "");
  if (!family || /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(family)) {
    return undefined;
  }
  return family;
}

function numericWeight(value: string | undefined): number {
  if (!value) return 400;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.min(1000, Math.max(1, n));
  if (/bold/i.test(value)) return 700;
  if (/medium/i.test(value)) return 500;
  if (/light/i.test(value)) return 300;
  return 400;
}

/** Collect the concrete font faces the SVG expects before Figma parses it. */
export function svgFontRequests(svg: string): SvgFontRequest[] {
  const found = new Map<string, SvgFontRequest>();
  for (const tag of svg.match(/<(?:text|tspan)\b[^>]*>/gi) ?? []) {
    const parsed = attrs(tag);
    const family = firstFamily(parsed.get("font-family")?.value ?? "");
    if (!family) continue;
    const request: SvgFontRequest = {
      family,
      weight: numericWeight(parsed.get("font-weight")?.value),
      italic: /^(italic|oblique)$/i.test(parsed.get("font-style")?.value ?? ""),
    };
    found.set(`${request.family.toLowerCase()}|${request.weight}|${request.italic}`, request);
  }
  return [...found.values()];
}

/** Read the exporter-owned `<g id="…" data-token="…">` hints before Figma drops them. */
export function svgTokenAnnotations(svg: string): SvgTokenAnnotation[] {
  const out: SvgTokenAnnotation[] = [];
  for (const tag of svg.match(/<g\b[^>]*>/gi) ?? []) {
    const parsed = attrs(tag);
    const layer = parsed.get("id")?.value.trim();
    const token = parsed.get("data-token")?.value.trim();
    if (layer && token) out.push({ layer, token });
  }
  return out;
}

function styleWeight(style: string): number {
  if (/thin|hairline/i.test(style)) return 100;
  if (/extra\s*light|ultra\s*light/i.test(style)) return 200;
  if (/light/i.test(style)) return 300;
  if (/medium/i.test(style)) return 500;
  if (/semi\s*bold|demi\s*bold/i.test(style)) return 600;
  if (/extra\s*bold|ultra\s*bold/i.test(style)) return 800;
  if (/black|heavy/i.test(style)) return 900;
  if (/bold/i.test(style)) return 700;
  return 400;
}

/** Pick the closest available Figma face without silently changing families. */
export function chooseAvailableFont(
  request: SvgFontRequest,
  available: readonly AvailableFont[],
): AvailableFont | undefined {
  const family = available.filter((font) => font.family.toLowerCase() === request.family.toLowerCase());
  return family.sort((a, b) => {
    const score = (font: AvailableFont): number =>
      Math.abs(styleWeight(font.style) - request.weight) +
      ((/italic|oblique/i.test(font.style)) === request.italic ? 0 : 1000);
    return score(a) - score(b) || a.style.localeCompare(b.style);
  })[0];
}

function almost(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

function inferAxis(
  container: { width: number; height: number },
  children: readonly LayoutBox[],
  mode: "HORIZONTAL" | "VERTICAL",
): InferredAutoLayout | undefined {
  const primaryStart = (box: LayoutBox): number => mode === "HORIZONTAL" ? box.x : box.y;
  const primarySize = (box: LayoutBox): number => mode === "HORIZONTAL" ? box.width : box.height;
  const crossStart = (box: LayoutBox): number => mode === "HORIZONTAL" ? box.y : box.x;
  const crossSize = (box: LayoutBox): number => mode === "HORIZONTAL" ? box.height : box.width;
  const crossExtent = mode === "HORIZONTAL" ? container.height : container.width;
  const ordered = children.map((box, index) => ({ box, index })).sort((a, b) => primaryStart(a.box) - primaryStart(b.box));
  const gaps = ordered.slice(1).map((item, i) =>
    primaryStart(item.box) - (primaryStart(ordered[i]!.box) + primarySize(ordered[i]!.box))
  );
  if (gaps.some((gap) => gap < -1)) return undefined;
  const gap = gaps[0] ?? 0;
  if (gaps.some((value) => !almost(value, gap))) return undefined;

  const alignments = ordered.map(({ box }) => {
    const start = crossStart(box);
    const end = crossExtent - start - crossSize(box);
    if (almost(start, end)) return "CENTER" as const;
    if (start < end) return "MIN" as const;
    return "MAX" as const;
  });
  if (!alignments.every((alignment) => alignment === alignments[0])) return undefined;

  const minX = Math.min(...children.map((box) => box.x));
  const minY = Math.min(...children.map((box) => box.y));
  const maxX = Math.max(...children.map((box) => box.x + box.width));
  const maxY = Math.max(...children.map((box) => box.y + box.height));
  return {
    mode,
    gap: Math.max(0, gap),
    paddingTop: Math.max(0, minY),
    paddingRight: Math.max(0, container.width - maxX),
    paddingBottom: Math.max(0, container.height - maxY),
    paddingLeft: Math.max(0, minX),
    counterAxisAlignItems: alignments[0] ?? "MIN",
    order: ordered.map((item) => item.index),
  };
}

/**
 * Infer Auto Layout only for an unambiguous row/column (or a single padded
 * child). Overlapping/diagonal/freeform art remains ordinary vector layout.
 */
export function inferAutoLayout(
  container: { width: number; height: number },
  children: readonly LayoutBox[],
): InferredAutoLayout | undefined {
  if (children.length === 0 || children.some((box) => box.width < 0 || box.height < 0)) return undefined;
  if (children.length === 1) return inferAxis(container, children, "HORIZONTAL");
  const horizontal = inferAxis(container, children, "HORIZONTAL");
  const vertical = inferAxis(container, children, "VERTICAL");
  if (!!horizontal === !!vertical) return undefined;
  return horizontal ?? vertical;
}
