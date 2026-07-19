/** Read intrinsic width/height from an SVG's root tag, without an image lib. */
export function svgSize(bytes: Uint8Array): { width: number; height: number } {
  const text = new TextDecoder().decode(bytes);
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) {
    throw new Error("figma: rendered image is not an SVG");
  }
  const tag = open[0];
  const attr = (name: string): string | undefined =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  // Prefer explicit px width/height; fall back to the viewBox's extent. Reject
  // `%`/`em`/etc. (no intrinsic pixel size) so those fall through to viewBox.
  const px = (v: string | undefined): number | undefined => {
    const m = v ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v) : null;
    const n = m ? Number.parseFloat(m[1]!) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  let width = px(attr("width"));
  let height = px(attr("height"));
  if (width === undefined || height === undefined) {
    const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
      width ??= vb[2];
      height ??= vb[3];
    }
  }
  const w = width !== undefined ? Math.round(width) : 0;
  const h = height !== undefined ? Math.round(height) : 0;
  if (w <= 0 || h <= 0) {
    throw new Error("figma: SVG has no usable dimensions");
  }
  return { width: w, height: h };
}
