/**
 * `@design-parity/page-backdrop` — key design pages as backdrops, with the code
 * components placed and linked on top of them.
 *
 * **Opt-in, off by default.** Nothing here runs unless a repo commits a
 * `design-pages.json` with `"enabled": true` *and* someone invokes the
 * `design-parity-pages` CLI. The package is not referenced by
 * `@design-parity/action`, so the PR bot's behaviour is unchanged whether or
 * not a repo has adopted it. See {@link loadPageBackdropConfig}.
 *
 * The flow is three deliberate steps:
 *
 *   1. **import** — fetch the key pages from Figma, find the component
 *      instances on each, link every one back to a code handle, and commit the
 *      result ({@link importPages}, {@link writeImport}).
 *   2. **view** — render the committed manifest as one offline HTML page with
 *      the backdrop, the hotspots, and an optional render overlay
 *      ({@link renderPageBackdropHtml}).
 *   3. everything downstream reads the committed manifest; no live design-tool
 *      call happens at review time.
 */
export type {
  BackdropImage,
  BackdropPage,
  PageBackdropManifest,
  PageRect,
  Placement,
  PlacementLink,
  PlacementRender,
} from "./types.js";
export { PAGE_BACKDROP_VERSION } from "./types.js";

export type {
  BackdropFormat,
  DisabledReason,
  OverlayBlend,
  OverlayConfig,
  PageBackdropConfig,
  PageBackdropStatus,
  PageSelector,
} from "./config.js";
export {
  CONFIG_FILENAME,
  explainDisabled,
  loadPageBackdropConfig,
  readPageBackdropConfig,
  slugify,
} from "./config.js";

export type { ComponentMeta, PageDocument, PageFetcher, PageNode } from "./fetcher.js";
export { figmaRestPageFetcher } from "./fetcher.js";

// Reading an addressable SVG backdrop. Public because the manifest says a page
// is `format: "svg"` and any consumer that draws one — a preview server, an IDE
// panel — then has to find elements by node id, which is this and only this.
export {
  assertAddressableSvg,
  canonicalNodeId,
  countNodeIds,
  inlineableSvg,
  nodeIdsIn,
  svgFrameSize,
  svgNodeId,
} from "./svg-backdrop.js";

export type { InstanceHit } from "./instances.js";
export { collectInstances, frameSize } from "./instances.js";

export type { LinkedPlacement, LinkInputs } from "./link.js";
export { baseComponentName, codeConnectIndexOf, linkInstance, linkInstances } from "./link.js";

export type { ImportOptions, ImportResult } from "./import.js";
export { MANIFEST_FILENAME, importPages, parseManifest, writeImport } from "./import.js";

export type { ViewerOptions } from "./viewer.js";
export { renderPageBackdropHtml } from "./viewer.js";
