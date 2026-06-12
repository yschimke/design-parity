/**
 * Color parsing + WCAG contrast math. Pure, dependency-free, deterministic.
 */

/** Straight-alpha RGB, channels in 0–255, alpha in 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse a CSS-ish color string: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or
 * `rgb()/rgba()`. Returns `undefined` for anything we can't read so callers can
 * skip rather than guess.
 */
export function parseColor(input: string): Rgba | undefined {
  const s = input.trim();
  const hex = s.startsWith("#") ? s.slice(1) : undefined;
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) {
      const r = dup(hex[0]);
      const g = dup(hex[1]);
      const b = dup(hex[2]);
      const aByte = hex.length === 4 ? dup(hex[3]) : 255;
      if (
        r === undefined ||
        g === undefined ||
        b === undefined ||
        aByte === undefined
      )
        return undefined;
      return { r, g, b, a: aByte / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = byte(hex.slice(0, 2));
      const g = byte(hex.slice(2, 4));
      const b = byte(hex.slice(4, 6));
      const a = hex.length === 8 ? byte(hex.slice(6, 8)) : 255;
      if (r === undefined || g === undefined || b === undefined || a === undefined)
        return undefined;
      return { r, g, b, a: a / 255 };
    }
    return undefined;
  }

  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean);
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    if (r === undefined || g === undefined || b === undefined) return undefined;
    const a = parts[3] === undefined ? 1 : clamp01(num(parts[3]) ?? 1);
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a };
  }
  return undefined;
}

/**
 * Composite a (possibly translucent) foreground over an opaque background.
 * WCAG contrast is defined on opaque colors; translucent text must be flattened
 * against what's behind it first.
 */
export function flatten(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg;
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** Relative luminance per WCAG 2.x (sRGB). */
export function relativeLuminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * WCAG contrast ratio between two colors (1–21). `fg` is flattened over `bg`
 * first when translucent, so order matters: pass foreground then background.
 */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(flatten(fg, bg));
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Round to 2dp for stable, readable messages and snapshots. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dup(ch: string | undefined): number | undefined {
  if (ch === undefined) return undefined;
  const v = byte(ch + ch);
  return v;
}

function byte(hex: string): number | undefined {
  if (!/^[0-9a-fA-F]{2}$/.test(hex)) return undefined;
  return parseInt(hex, 16);
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const v = Number(s.endsWith("%") ? (Number(s.slice(0, -1)) / 100) * 255 : s);
  return Number.isFinite(v) ? v : undefined;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, n));
}
