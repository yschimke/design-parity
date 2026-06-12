/**
 * `@design-parity/adapter-claude-design` — the Claude Design reference driver.
 *
 * Claude Design is a research preview with **no read API and no Figma export**.
 * The reference is consumed as a committed HTML export (linked via
 * `design-map.json`) that this adapter rasterizes headlessly and normalizes to
 * a {@link DesignReference} with `linkMethod: "manifest"`. Depends only on
 * `@design-parity/core`.
 */
export {
  ClaudeDesignAdapter,
  type ClaudeDesignAdapterOptions,
} from "./adapter.js";

export {
  parseHandoff,
  HANDOFF_MIME,
  type HandoffManifest,
  type HandoffImage,
} from "./html-export.js";

export {
  browserRasterizer,
  type Rasterizer,
  type RasterRequest,
  type RasterResult,
} from "./rasterizer.js";

export { readPngSize, parsePngSize, type PngSize } from "./png.js";
