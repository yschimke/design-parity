/**
 * Reading an **addressable** SVG backdrop.
 *
 * A page exported with `svg_include_node_id` carries `data-node-id` on every
 * element, which is the whole reason to prefer it over a PNG: the backdrop stops
 * being a picture and becomes a document the viewer can point at. Given a
 * placement's node id, the element is right there — so a code render can be
 * dropped into the hole where the design element was, rather than laid on top of
 * it at half opacity and squinted at.
 *
 * It also removes a second, weaker source of truth. A raster backdrop has no
 * structure, so every placement's geometry has to be recorded alongside it and
 * trusted; with an SVG the element's box is whatever the browser measures.
 *
 * Everything here is string-level on purpose. The importer has to answer "did
 * this export actually come back addressable?" before it commits the file, and
 * that is a question about the bytes Figma returned — pulling in a DOM parser to
 * ask it would trade the package's one real constraint (no dependencies on the
 * committed path) for nothing.
 */

/**
 * Figma spells the same node two ways — `1:2` in the REST API, `1-2` in a URL
 * and in exported SVG markup. A consumer matching an id from the manifest
 * against the markup has to agree on one; this is it.
 */
export function canonicalNodeId(nodeId: string): string {
  return nodeId.replace(/-/g, ":");
}

/** The `data-node-id` spelling of a node id, as the export writes it. */
export function svgNodeId(nodeId: string): string {
  return canonicalNodeId(nodeId).replace(/:/g, "-");
}

const NODE_ID_ATTR = /\bdata-node-id\s*=\s*"([^"]*)"/g;

/** Every node id the export stamped, in document order, deduplicated. */
export function nodeIdsIn(svg: string): string[] {
  const seen = new Set<string>();
  for (const match of svg.matchAll(NODE_ID_ATTR)) {
    const raw = match[1];
    if (raw) seen.add(canonicalNodeId(raw));
  }
  return [...seen];
}

/**
 * How many `data-node-id` attributes the export carries.
 *
 * The check that matters most, and the reason it is separate from
 * {@link nodeIdsIn}: an export requested WITH ids and returned WITHOUT them is
 * indistinguishable from a valid picture, and every downstream consumer would
 * silently degrade to "no element found" — one placement at a time, with nothing
 * logged. Counting them is how the importer fails loudly instead.
 */
export function countNodeIds(svg: string): number {
  return (svg.match(/\bdata-node-id\s*=/g) ?? []).length;
}

/** The frame size an export declares, from its `viewBox` or its width/height. */
export function svgFrameSize(svg: string): { width: number; height: number } {
  const root = svg.slice(0, svg.indexOf(">") + 1);

  // viewBox first: it is the coordinate space the ids live in, whereas
  // width/height are a presentation hint an exporter may write in any unit.
  const viewBox = /\bviewBox\s*=\s*"([^"]*)"/i.exec(root)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }

  const width = Number(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/i.exec(root)?.[1]);
  const height = Number(/\bheight\s*=\s*"(\d+(?:\.\d+)?)"/i.exec(root)?.[1]);
  if (width > 0 && height > 0) return { width, height };

  throw new Error("page-backdrop: the exported SVG declares no usable viewBox or size");
}

/**
 * An export, ready to be inlined into an HTML document.
 *
 * Inlining is not optional for this feature — inside an `<img>` the markup is an
 * opaque box and the ids are unreachable — but it does mean the export's
 * elements join the viewer's own document, so two things are stripped first:
 *
 * - **The XML prolog and any doctype.** Legal at the top of a standalone `.svg`
 *   file, invalid partway through an HTML body.
 * - **`<script>`.** Figma's exporter does not emit any, and that is exactly why
 *   dropping them costs nothing. The viewer is a file someone opens from a PR
 *   artifact; a design file is edited by anyone with a share link, and "our
 *   vendor would never" is not a property this page can check.
 */
export function inlineableSvg(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .trim();
}

/**
 * Check an export is what it claims to be, before anything commits it.
 *
 * Both failures here are ones that would otherwise surface much later and much
 * more confusingly: markup that isn't an SVG at all (an error page fetched from
 * a signed URL that had expired), and an SVG with no ids in it.
 */
export function assertAddressableSvg(svg: string, nodeId: string): void {
  if (!/^\s*<svg\b/i.test(svg)) {
    throw new Error(
      `page-backdrop: the export for '${nodeId}' did not start with an <svg> element`,
    );
  }
  if (countNodeIds(svg) === 0) {
    throw new Error(
      `page-backdrop: the SVG export for '${nodeId}' carries no data-node-id attributes — ` +
        `it is a picture, not an addressable document. Was svg_include_node_id set?`,
    );
  }
}
