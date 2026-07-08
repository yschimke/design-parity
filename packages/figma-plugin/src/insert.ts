/**
 * The **execution** half of the single-component picker: place one catalog
 * component on the canvas — as a raster (the shipping PNG render) or as an
 * editable vector (the wireframe SVG) — per the designer's format choice.
 *
 * `catalogPick.ts` (discovery) resolves a {@link PickSelection} to a concrete
 * image URL / wireframe; the UI fetches its bytes / text; this module owns what
 * the main thread does with them: create one stamped node and drop it on the
 * current page. Unlike `scene.ts` (which reconciles a whole sticker sheet) and
 * `live.ts` (which stamps refreshable render provenance), a catalog insert is a
 * standalone snapshot of a *published, static* render — so it carries only its
 * identity ({@link INSERT_ROLE} + `componentId`), no refresh source: there is no
 * live server to re-render it against.
 *
 * Pure given the injected {@link FigmaApi} + already-fetched bytes: asserted
 * headlessly against the fake node.
 */
import { STAMP, type FigmaApi, type FigmaNode } from "./scene.js";

/** The `role` a single inserted catalog component carries. */
export const INSERT_ROLE = "catalog-insert";

/** Pixel size for the placed frame; the render fills it (scaleMode `FILL`). */
export interface InsertSize {
  width: number;
  height: number;
}

/** Fallback size when the render's pixel dimensions aren't known at placement. */
const DEFAULT_SIZE: InsertSize = { width: 320, height: 200 };

/** Options shared by the PNG and SVG inserts. */
export interface InsertOptions {
  /** The node name; defaults to the component id. */
  name?: string;
  /** The catalog `componentId`, stamped for identity (matches by nothing else). */
  componentId?: string;
}

/** Options for {@link placeCatalogPng} — an insert size on top of the shared ones. */
export interface InsertPngOptions extends InsertOptions {
  /** The node's pixel size; defaults to {@link DEFAULT_SIZE}. */
  size?: InsertSize;
}

/** True when `node` is a single catalog component this module inserted. */
export function isCatalogInsert(node: FigmaNode): boolean {
  return node.getSharedPluginData(STAMP, "role") === INSERT_ROLE;
}

/** Stamp identity onto a freshly created insert node. */
function stampInsert(node: FigmaNode, opts: InsertOptions): void {
  node.setSharedPluginData(STAMP, "role", INSERT_ROLE);
  if (opts.componentId) node.setSharedPluginData(STAMP, "componentId", opts.componentId);
}

/**
 * Place a single catalog component as a **raster**: a frame filled with the
 * fetched PNG bytes, stamped with the {@link INSERT_ROLE} identity. Appends it to
 * the current page and scrolls it into view; returns the created node.
 */
export function placeCatalogPng(
  figma: FigmaApi,
  bytes: Uint8Array,
  opts: InsertPngOptions = {},
): FigmaNode {
  const node = figma.createFrame();
  node.name = opts.name ?? opts.componentId ?? "Component";
  const size = opts.size ?? DEFAULT_SIZE;
  node.resize(size.width, size.height);
  const hash = figma.createImage(bytes).hash;
  node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
  stampInsert(node, opts);
  figma.currentPage.appendChild(node);
  figma.viewport.scrollAndZoomIntoView([node]);
  return node;
}

/**
 * Place a single catalog component as an **editable vector**: Figma parses the
 * wireframe SVG into a real frame of shapes (not a flat raster), stamped with the
 * {@link INSERT_ROLE} identity. `createNodeFromSvg` adds the node to the current
 * page itself, so this only names, stamps, and frames it. The `svg` must be
 * self-contained (the catalog bakes any raster crops in as data URIs).
 */
export function placeCatalogSvg(
  figma: FigmaApi,
  svg: string,
  opts: InsertOptions = {},
): FigmaNode {
  const node = figma.createNodeFromSvg(svg);
  node.name = opts.name ?? opts.componentId ?? "Component";
  stampInsert(node, opts);
  figma.viewport.scrollAndZoomIntoView([node]);
  return node;
}
