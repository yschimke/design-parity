/**
 * Inline an SVG's external raster crops so Figma can place it.
 *
 * The delivery branch's editable design vector (`figma/<slug>.svg`, the
 * `compose/figma-svg` export) is pure vector for most stickers, but a **hybrid**
 * sticker (an opaque Image/Icon/Canvas node) references raster crops via
 * `<image href="<slug>.figma-raster/<node>.png">`. Figma's `createNodeFromSvg`
 * cannot resolve external hrefs — `fetch` is undefined in the plugin sandbox — so
 * those crops must be **inlined as `data:` URIs** before the SVG is placed. The
 * UI (the only realm with `fetch`) pulls the referenced bytes; this module is the
 * pure text surgery either side of that.
 *
 * Pure: no `figma`, no `fetch`.
 */

/**
 * The external (non-`data:`) `<image>` href targets in an SVG, deduped in
 * first-seen order — the raster crops that must be inlined before placing. Matches
 * both `href` and `xlink:href`; already-inlined `data:` URIs are skipped.
 */
export function svgRasterHrefs(svg: string): string[] {
  const re = /<image\b[^>]*?\b(?:xlink:href|href)\s*=\s*(['"])(.*?)\1/gi;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    const href = match[2];
    if (href && !/^data:/i.test(href) && !out.includes(href)) out.push(href);
  }
  return out;
}

/**
 * Replace each external raster href in the SVG with its inlined `data:` URI.
 * Substitutes the exact **quoted** attribute value (both `"…"` and `'…'`), so a
 * shorter href can't clobber a longer one it's a prefix of. Hrefs not in the map
 * are left as-is.
 */
export function inlineSvgRasters(svg: string, dataUriByHref: Map<string, string>): string {
  let out = svg;
  for (const [href, dataUri] of dataUriByHref) {
    out = out
      .split(`"${href}"`)
      .join(`"${dataUri}"`)
      .split(`'${href}'`)
      .join(`'${dataUri}'`);
  }
  return out;
}
