/**
 * The **execution** half of the override editor: place a single live-rendered
 * preview on the canvas, and refresh it against updated code.
 *
 * `previews.ts` (discovery) turns the editor's state into a {@link RenderSource};
 * the UI fetches that source's `/render` bytes; this module owns what the main
 * thread does with them — create (or re-fill) one node and **stamp the
 * `RenderSource` as provenance** (`provenance.ts`) so a later Refresh knows
 * exactly what to re-fetch. Unlike the catalog builder (`scene.ts`), which
 * reconciles a whole sticker sheet, this places a standalone,
 * individually-refreshable component (the "branch off a root, still connected"
 * flow, one node at a time).
 *
 * Pure given the injected {@link FigmaApi} + already-fetched bytes (no `fetch`,
 * no `figma` global): asserted headlessly against the fake node.
 */
import { readRenderSource, stampRenderSource } from "./provenance.js";
import { buildRenderUrl, type RenderFormat, type RenderSource } from "./render.js";
import { STAMP, type FigmaApi, type FigmaNode } from "./scene.js";

/** The `role` a standalone live-rendered node carries (distinct from catalog cells). */
export const LIVE_ROLE = "live-render";

/** A live-render node's on-canvas size; the render fills it (scaleMode `FILL`). */
export interface LiveRenderSize {
  width: number;
  height: number;
}

/** Fallback size when the render's pixel dimensions aren't known at placement. */
const DEFAULT_SIZE: LiveRenderSize = { width: 320, height: 200 };

/** Options for {@link placeLiveRender}. */
export interface PlaceLiveOptions {
  /** The node's pixel size; defaults to {@link DEFAULT_SIZE} when the render's aren't known. */
  size?: LiveRenderSize;
  /** The node name; defaults to the preview id. */
  name?: string;
}

/** True when `node` is a standalone live render this module placed. */
export function isLiveRender(node: FigmaNode): boolean {
  return node.getSharedPluginData(STAMP, "role") === LIVE_ROLE;
}

/**
 * Place a single live-rendered preview: a frame filled with the fetched bytes,
 * stamped with the {@link LIVE_ROLE} and the {@link RenderSource} provenance that
 * powers a later Refresh. Appends it to the current page and scrolls it into
 * view; returns the created node.
 */
export function placeLiveRender(
  figma: FigmaApi,
  source: RenderSource,
  bytes: Uint8Array,
  opts: PlaceLiveOptions = {},
): FigmaNode {
  const node = figma.createFrame();
  node.name = opts.name ?? source.previewId;
  const size = opts.size ?? DEFAULT_SIZE;
  node.resize(size.width, size.height);
  const hash = figma.createImage(bytes).hash;
  node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
  node.setSharedPluginData(STAMP, "role", LIVE_ROLE);
  stampRenderSource(node, source);
  figma.currentPage.appendChild(node);
  figma.viewport.scrollAndZoomIntoView([node]);
  return node;
}

/**
 * Place a live render as an **editable SVG** (import mode c): Figma parses the
 * vector into a real frame of shapes (not a flat raster), stamped with
 * {@link LIVE_ROLE} and its {@link RenderSource} provenance. `createNodeFromSvg`
 * adds the node to the current page itself, so this only names, stamps, and
 * frames it. The `svg` must be self-contained — the serve host inlines any
 * raster crops as data URIs, since Figma can't resolve external hrefs.
 */
export function placeLiveSvg(
  figma: FigmaApi,
  source: RenderSource,
  svg: string,
  opts: PlaceLiveOptions = {},
): FigmaNode {
  const node = figma.createNodeFromSvg(svg);
  node.name = opts.name ?? source.previewId;
  node.setSharedPluginData(STAMP, "role", LIVE_ROLE);
  stampRenderSource(node, source);
  figma.viewport.scrollAndZoomIntoView([node]);
  return node;
}

/**
 * One node to re-fetch on Refresh: the node, the URL its provenance rebuilds, and
 * its {@link RenderFormat} — the UI fetches PNG jobs as bytes (→ {@link refreshLiveRender},
 * an in-place fill swap) and SVG jobs as text (→ {@link refreshLiveSvg}, a re-place).
 */
export interface RefreshJob {
  node: FigmaNode;
  url: string;
  format: RenderFormat;
}

/**
 * Plan a Refresh over a selection: for each live node carrying render provenance,
 * the URL to re-fetch (rebuilt from its stamp, so it re-renders against current
 * code) and its format. Nodes with no provenance — a designer's own content, or a
 * static import — are skipped, so a mixed selection only touches live nodes.
 */
export function planRefresh(nodes: readonly FigmaNode[]): RefreshJob[] {
  const jobs: RefreshJob[] = [];
  for (const node of nodes) {
    const source = readRenderSource(node);
    if (!source) continue;
    jobs.push({ node, url: buildRenderUrl(source), format: source.format });
  }
  return jobs;
}

/**
 * Re-fill a **PNG** live node with freshly fetched bytes, keeping its identity,
 * size, and provenance intact. Returns the node's {@link RenderSource} (what was
 * re-rendered), or `undefined` when the node isn't a PNG live import — no
 * provenance, or an SVG node (which refreshes via {@link refreshLiveSvg}), so
 * there's nothing to swap here.
 */
export function refreshLiveRender(
  figma: FigmaApi,
  node: FigmaNode,
  bytes: Uint8Array,
): RenderSource | undefined {
  const source = readRenderSource(node);
  if (!source || source.format !== "png") return undefined;
  const hash = figma.createImage(bytes).hash;
  node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
  return source;
}

/**
 * Refresh an **SVG** live node against freshly fetched SVG text. An SVG node is a
 * parsed frame of vector shapes, not an image, so it can't be re-filled in place:
 * this parses a **new** node from the fresh SVG ({@link FigmaApi.createNodeFromSvg}),
 * moves it to the old node's position, carries over its name + {@link LIVE_ROLE} +
 * provenance, then removes the old node. Returns the node's {@link RenderSource},
 * or `undefined` when it isn't an SVG live import. The replacement is a new node
 * (a fresh vector tree), so any designer edits to the old shapes don't carry over.
 */
export function refreshLiveSvg(
  figma: FigmaApi,
  node: FigmaNode,
  svg: string,
): RenderSource | undefined {
  const source = readRenderSource(node);
  if (!source || source.format !== "svg") return undefined;
  const replacement = figma.createNodeFromSvg(svg);
  replacement.name = node.name;
  if (node.x !== undefined) replacement.x = node.x;
  if (node.y !== undefined) replacement.y = node.y;
  replacement.setSharedPluginData(STAMP, "role", LIVE_ROLE);
  stampRenderSource(replacement, source);
  node.remove();
  return source;
}
