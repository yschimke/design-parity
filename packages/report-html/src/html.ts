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
