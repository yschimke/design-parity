/**
 * Tiny HTML helpers, mirroring `@design-parity/report-html`'s: no template
 * engine, everything inlined by hand so the output is deterministic and the
 * page is fully self-contained.
 *
 * Kept local rather than imported: `report-html` is a leaf consumer of the
 * parity run, and a page backdrop is not a parity run — pointing this package
 * at it would invert that.
 */

/** Escape text for element content and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap raw PNG bytes in a `data:` URI suitable for an `<img src>`. */
export function pngDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/**
 * Escape a value going inside a double-quoted CSS attribute selector.
 *
 * Page slugs and node ids can't contain either character today; this is here so
 * that stops being load-bearing, since a generated selector that breaks out of
 * its quotes is a stylesheet that silently stops matching.
 */
export function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Percentage string with 4dp — enough to be pixel-exact, stable in a diff. */
export function pct(value: number, of: number): string {
  if (!(of > 0)) return "0%";
  return `${Math.round((value / of) * 1000000) / 10000}%`;
}
