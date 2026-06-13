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
  FigmaApiError,
  type FigmaErrorCode,
} from "./errors.js";
