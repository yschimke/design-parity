/**
 * Shared colour + label helpers for the annotation layers, kept in one place so
 * the SVG preview ({@link planToSvg}) and the Figma main thread
 * ({@link figma/code.ts}) draw the same thing:
 *
 * - **greenlines** (a11y) — severity-coloured: green info, amber warn, red error
 *   (the "greenline" name is the a11y convention, not a literal colour);
 * - **redlines** (layout/spacing) — a single blue accent plus a text spec.
 */
import type { Severity } from "@design-parity/core";
import type { Redline } from "@design-parity/catalog-export";

/** A colour in 0–1 RGB channels, the shape Figma's paint API wants. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX: Record<Severity, string> = {
  info: "#1a7f37",
  warn: "#bf8700",
  error: "#cf222e",
};

/** CSS hex for a finding severity (SVG preview). */
export function severityHex(severity: Severity): string {
  return HEX[severity];
}

/** The redline (layout/spacing) accent colour. */
export const REDLINE_HEX = "#0969da";

function hexToRgb(hex: string): Rgb {
  const h = hex.replace(/^#/, "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** 0–1 RGB for a finding severity (Figma paints). */
export function severityRgb(severity: Severity): Rgb {
  return hexToRgb(HEX[severity]);
}

/** 0–1 RGB for the redline accent (Figma paints). */
export function redlineRgb(): Rgb {
  return hexToRgb(REDLINE_HEX);
}

/**
 * A one-line spacing spec for a redline: role/label prefix plus the padding
 * (`top/end/bottom/start`), inter-slot `gap`, and corner `radius` it declares.
 * Returns `""` when the redline carries no measurable spec.
 */
export function redlineLabel(redline: Redline): string {
  const parts: string[] = [];
  const name = redline.label ?? redline.role;
  if (name) parts.push(name);
  const p = redline.padding;
  if (p && (p.top ?? p.end ?? p.bottom ?? p.start) !== undefined) {
    parts.push(`pad ${p.top ?? 0}/${p.end ?? 0}/${p.bottom ?? 0}/${p.start ?? 0}`);
  }
  if (redline.gap !== undefined) parts.push(`gap ${redline.gap}`);
  if (redline.cornerRadius !== undefined) parts.push(`r ${redline.cornerRadius}`);
  return parts.join(" · ");
}
