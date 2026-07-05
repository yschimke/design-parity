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
import { readRenderSource, refreshUrl, stampRenderSource } from "./provenance.js";
import type { RenderSource } from "./render.js";
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

/** One node to re-fetch on Refresh: the node and the URL its provenance rebuilds. */
export interface RefreshJob {
  node: FigmaNode;
  url: string;
}

/**
 * Plan a Refresh over a selection: for each node that carries render provenance,
 * the URL to re-fetch (rebuilt from its stamp, so it re-renders against current
 * code). Nodes with no provenance — a designer's own content, or a static
 * import — are skipped, so refreshing a mixed selection only touches live nodes.
 */
export function planRefresh(nodes: readonly FigmaNode[]): RefreshJob[] {
  const jobs: RefreshJob[] = [];
  for (const node of nodes) {
    const url = refreshUrl(node);
    if (url) jobs.push({ node, url });
  }
  return jobs;
}

/**
 * Re-fill a live node with freshly fetched bytes, keeping its identity, size, and
 * provenance intact. Returns the node's {@link RenderSource} (what was
 * re-rendered), or `undefined` when the node carries no provenance — i.e. it
 * isn't a live import, so there's nothing to refresh.
 */
export function refreshLiveRender(
  figma: FigmaApi,
  node: FigmaNode,
  bytes: Uint8Array,
): RenderSource | undefined {
  const source = readRenderSource(node);
  if (!source) return undefined;
  const hash = figma.createImage(bytes).hash;
  node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
  return source;
}
