/**
 * Extract {@link DesignTokens} from Stitch's Tailwind-classed HTML. Pure string
 * work — no DOM library — so it runs anywhere and is fully deterministic.
 *
 * Stitch emits a flat component: a root container plus a heading (title) and a
 * paragraph (body). We read spacing/radius/background off the container and
 * colour + typography off the title and body elements.
 */
import type { DesignTokens, TypographyToken } from "@design-parity/core";

/** Tailwind's spacing scale is `n * 0.25rem`; at the 16px root that's `n * 4`. */
const SPACING_STEP = 4;

const RADIUS_NAMED: Record<string, number> = {
  none: 0,
  sm: 2,
  "": 4, // bare `rounded`
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
};

const TEXT_NAMED: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
};

const WEIGHT_NAMED: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

interface Element {
  tag: string;
  classes: string[];
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Split the document into `{ tag, classes }` for every opening tag. */
function parseElements(html: string): Element[] {
  const out: Element[] = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const tag = m[1]!.toLowerCase();
    const classMatch = /class\s*=\s*"([^"]*)"/.exec(m[2]!);
    const classes = classMatch ? classMatch[1]!.split(/\s+/).filter(Boolean) : [];
    out.push({ tag, classes });
  }
  return out;
}

/** `#abc` / `#aabbcc[aa]` → upper-cased, or pass non-hex arbitrary values through. */
function normalizeColor(value: string): string {
  return value.startsWith("#") ? `#${value.slice(1).toUpperCase()}` : value;
}

/** `[18px]` / `[#fff]` → `18px` / `#fff`; `null` if not an arbitrary value. */
function arbitrary(token: string): string | null {
  const m = /^\[(.+)\]$/.exec(token);
  return m ? m[1]! : null;
}

/** Pixels from a Tailwind length token like `18px`, `1.5rem`, `12`. */
function px(value: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return undefined;
  return m[2] === "rem" ? n * 16 : n;
}

function scale(value: string): number | undefined {
  const arb = arbitrary(value);
  if (arb) return px(arb);
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n * SPACING_STEP;
}

function firstValue<T>(
  classes: string[],
  prefix: string,
  map: (rest: string) => T | undefined,
): T | undefined {
  for (const c of classes) {
    if (c === prefix || c.startsWith(`${prefix}-`)) {
      const rest = c === prefix ? "" : c.slice(prefix.length + 1);
      const val = map(rest);
      if (val !== undefined) return val;
    }
  }
  return undefined;
}

function colorOf(classes: string[], prefix: string): string | undefined {
  return firstValue(classes, prefix, (rest) => {
    const arb = arbitrary(rest);
    return arb && arb.startsWith("#") ? normalizeColor(arb) : undefined;
  });
}

function radiusOf(classes: string[]): number | undefined {
  return firstValue(classes, "rounded", (rest) => {
    const arb = arbitrary(rest);
    if (arb) return px(arb);
    return rest in RADIUS_NAMED ? RADIUS_NAMED[rest] : undefined;
  });
}

function typographyOf(classes: string[]): TypographyToken | undefined {
  const token: TypographyToken = {};

  const family = firstValue(classes, "font", (rest) => {
    const arb = arbitrary(rest);
    return arb ? arb.replace(/_/g, " ") : undefined;
  });
  if (family) token.fontFamily = family;

  const weight = firstValue(classes, "font", (rest) =>
    rest in WEIGHT_NAMED ? WEIGHT_NAMED[rest] : undefined,
  );
  if (weight !== undefined) token.fontWeight = weight;

  const size = firstValue(classes, "text", (rest) => {
    const arb = arbitrary(rest);
    if (arb) return px(arb);
    return rest in TEXT_NAMED ? TEXT_NAMED[rest] : undefined;
  });
  if (size !== undefined) token.fontSize = size;

  const lineHeight = firstValue(classes, "leading", (rest) => {
    const arb = arbitrary(rest);
    if (arb) return px(arb);
    const n = Number(rest);
    return Number.isNaN(n) ? undefined : n * SPACING_STEP;
  });
  if (lineHeight !== undefined) token.lineHeight = lineHeight;

  return Object.keys(token).length ? token : undefined;
}

/** Build `DesignTokens` from one screen's Tailwind-classed HTML. */
export function tokensFromHtml(html: string): DesignTokens | undefined {
  const elements = parseElements(html);
  if (elements.length === 0) return undefined;

  const container = elements[0]!;
  const title = elements.find((e) => HEADINGS.has(e.tag));
  const body = elements.find((e) => e.tag === "p");

  const tokens: DesignTokens = {};

  const spacing: Record<string, number> = {};
  const padding = firstValue(container.classes, "p", scale);
  if (padding !== undefined) spacing.padding = padding;
  const gap = firstValue(container.classes, "gap", scale);
  if (gap !== undefined) spacing.gap = gap;
  if (Object.keys(spacing).length) tokens.spacing = spacing;

  const corner = radiusOf(container.classes);
  if (corner !== undefined) tokens.radius = { corner };

  const colors: Record<string, string> = {};
  const containerColor = colorOf(container.classes, "bg");
  if (containerColor) colors.container = containerColor;
  const titleColor = title && colorOf(title.classes, "text");
  if (titleColor) colors.title = titleColor;
  const bodyColor = body && colorOf(body.classes, "text");
  if (bodyColor) colors.body = bodyColor;
  if (Object.keys(colors).length) tokens.colors = colors;

  const typography: Record<string, TypographyToken> = {};
  const titleType = title && typographyOf(title.classes);
  if (titleType) typography.title = titleType;
  const bodyType = body && typographyOf(body.classes);
  if (bodyType) typography.body = bodyType;
  if (Object.keys(typography).length) tokens.typography = typography;

  return Object.keys(tokens).length ? tokens : undefined;
}
