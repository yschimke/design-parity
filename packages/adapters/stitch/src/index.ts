/**
 * `@design-parity/adapter-stitch` — the Google Stitch `ReferenceAdapter`.
 *
 * Stitch ships `@google/stitch-sdk` + an MCP server but has **no Code Connect
 * equivalent**, so correspondence is resolved through the repo's
 * `design-map.json` (`linkMethod: "manifest"`). The adapter fetches HTML+Tailwind
 * via the SDK, rasterizes a reference image headlessly, and extracts
 * Tailwind-derived tokens. The SDK client and the rasterizer are injectable.
 */
export { StitchAdapter, createStitchAdapter } from "./adapter.js";
export type { StitchAdapterOptions } from "./adapter.js";

export {
  createSdkStitchClient,
  type StitchClient,
  type StitchDesign,
  type StitchScreen,
} from "./stitch-client.js";

export {
  browserRasterizer,
  type Rasterizer,
  type RasterizeInput,
} from "./rasterizer.js";

export { tokensFromHtml } from "./tailwind-tokens.js";

export {
  parseStitchRef,
  formatStitchRef,
  isStitchRef,
  type StitchRef,
} from "./stitch-ref.js";

export {
  StitchError,
  StitchAuthError,
  StitchManifestError,
  StitchBadRefError,
  StitchSdkError,
  StitchRasterizeError,
  type StitchErrorCode,
} from "./errors.js";
