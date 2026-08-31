import type { FigmaColor, FigmaPaint } from "./figma-api.js";

export function hex(c: FigmaColor): string {
  const ch = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  const base = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  return c.a < 1 ? `${base}${ch(c.a)}` : base;
}

export function solidFill(fills: FigmaPaint[] | undefined): string | undefined {
  const paint = fills?.find(
    (p) => p.type === "SOLID" && p.visible !== false && p.color,
  );
  return paint?.color ? hex(paint.color) : undefined;
}
