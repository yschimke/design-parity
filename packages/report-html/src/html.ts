/**
 * Tiny HTML helpers. No template engine — everything is inlined by hand so the
 * output is deterministic and the page is fully self-contained (no escaping
 * surprises, no external dependency).
 */

/** Escape text for use in element content / double-quoted attributes. */
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
  // Buffer.from(Uint8Array) shares no quirks here; base64 is deterministic.
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/** Wrap raw SVG bytes in a `data:` URI suitable for an `<img src>`. */
export function svgDataUri(svg: Uint8Array): string {
  // base64 keeps the payload opaque (no `#`/`"`/`&` escaping surprises) and
  // deterministic, matching {@link pngDataUri}.
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Whether an image reference is a vector SVG — a file path or a `data:` URI. */
export function isSvgSource(source: string): boolean {
  return /\.svg$/i.test(source) || source.startsWith("data:image/svg+xml");
}
