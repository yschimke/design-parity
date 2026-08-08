/**
 * `@design-parity/adapter-figma` — the Figma `ReferenceAdapter`.
 *
 * Figma is the keystone source: the only one with a machine-resolvable
 * design↔code link (Code Connect). This adapter uses the **REST API + Code
 * Connect**, never the Dev Mode MCP server (that is local/desktop oriented).
 */
export { FigmaAdapter, createFigmaAdapter } from "./adapter.js";
export type { FigmaAdapterOptions, RenderTarget } from "./adapter.js";

export { FigmaCanvasWriter, createFigmaCanvasWriter } from "./canvas-writer.js";
export type { FigmaCanvasWriterOptions, CanvasFetch } from "./canvas-writer.js";

export { FigmaRestClient } from "./rest-client.js";
export type {
  FetchLike,
  FigmaRestClientOptions,
  RenderedImage,
} from "./rest-client.js";

// The layout capture, public so a *publisher* can turn fetched Figma node JSON
// into the same SemanticTree the adapter builds — that tree is what feeds
// reference-side redline/typography annotations, and re-deriving geometry in the
// publisher would mean the two sides were measured by different code.
export { layoutFromNode } from "./layout.js";
export type { FigmaNodeDoc } from "./figma-api.js";

export {
  parseFigmaRef,
  formatFigmaRef,
  isFigmaRef,
  type FigmaRef,
} from "./figma-ref.js";

export {
  loadCodeConnect,
  parseCodeConnectDocs,
  resolveFromCodeConnect,
  type CodeConnectMap,
} from "./code-connect.js";

export {
  FigmaError,
  FigmaAuthError,
  FigmaRateLimitError,
  FigmaNodeNotFoundError,
  FigmaBadRefError,
  FigmaCacheMissError,
  FigmaApiError,
  type FigmaErrorCode,
} from "./errors.js";

// The committed reference cache: written by `design-parity import`, read by a
// parity run. Public because the import lives in `@design-parity/action` —
// the two halves of one contract, so the format is a published shape rather
// than a private detail of either.
export {
  ReferenceCache,
  ReferenceCacheWriter,
  cacheEntryDir,
  cacheKeyOf,
  emptyReferenceCache,
  nodeDirName,
  readReferenceCacheDoc,
  REFERENCE_CACHE_FORMAT_VERSION,
  REFERENCE_CACHE_INDEX,
} from "./reference-cache.js";
export type {
  CachedNodeDoc,
  ReferenceCacheDoc,
  ReferenceCacheEntry,
  ReferenceCacheFile,
} from "./reference-cache.js";

export type { FileMetaResponse, VariablesResponse } from "./figma-api.js";
