/**
 * Shared severity → colour mapping for the greenline (a11y) annotation layer.
 *
 * Kept in one place so the SVG preview ({@link planToSvg}) and the Figma main
 * thread ({@link figma/code.ts}) draw the same colours. Greens for info,
 * amber for warnings, red for errors — the "greenline" name is the a11y
 * convention (an annotation layer over a render), not a literal colour.
 */
import type { Severity } from "@design-parity/core";

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

/** 0–1 RGB for a finding severity (Figma paints). */
export function severityRgb(severity: Severity): Rgb {
  const hex = HEX[severity].replace(/^#/, "");
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}
