/**
 * `@design-parity/candidate` — the candidate side of parity.
 *
 * The candidate render is obtained via a **pluggable strategy** — a
 * {@link CandidateSource}. Phase 1 of issue #38 ships a static, pure-JS reader
 * for compose-ai-tools preview bundles ({@link bundleCandidateSource}); the
 * existing `compose-preview` CLI renderer is wrapped behind the same seam
 * ({@link cliRenderSource}); and the local Compose-for-Web and daemon backends
 * are defined but stubbed. Depends only on `@design-parity/core` (+ `fflate`).
 */

// Pluggable candidate-source strategy.
export type { CandidateSource } from "./source.js";
export { firstAvailable } from "./source.js";

export {
  bundleCandidateSource,
  cliRenderSource,
  localComposeWebSource,
} from "./sources.js";
export type {
  BundleSourceOptions,
  CliRenderOptions,
  CliRenderSourceOptions,
  LocalComposeWebOptions,
} from "./sources.js";

// Render-path selection: prefer the emulator-free CMP Desktop/JVM render,
// fall back to Android — never required (Principle 6, issue #30).
export { chooseRenderPath, applyRenderPath } from "./render-path.js";
export type {
  RenderPath,
  RenderPathCapability,
  RenderPathChoice,
} from "./render-path.js";

// Live compose-ai-tools daemon source + native data-product mappers (#43).
export {
  daemonSource,
  nativeFindings,
  atfFindings,
  touchTargetFindings,
  textStringFindings,
  translationFindings,
  hierarchyToSemanticTree,
  semanticsToSemanticTree,
  composeThemeToTokens,
  argbToCssHex,
  parseFontSizeSp,
  parseScreenBounds,
  normalizeFontFamily,
} from "./daemon.js";
export type {
  DaemonDataClient,
  DaemonImage,
  DaemonCandidate,
  DaemonCandidateSource,
  DaemonSourceOptions,
  NativeDataProducts,
  AtfPayload,
  AtfFinding,
  TouchTargetsPayload,
  TouchTarget,
  HierarchyPayload,
  HierarchyNode,
  ComposeSemanticsPayload,
  ComposeSemanticsNode,
  ComposeThemePayload,
  ComposeThemeTypography,
  TextStringsPayload,
  TextStringEntry,
  I18nTranslationsPayload,
  I18nVisibleString,
} from "./daemon.js";

// Production stdio JSON-RPC transport for the daemon source (#43).
export {
  StdioDaemonClient,
  JsonRpcConnection,
  FrameDecoder,
  encodeFrame,
} from "./daemon-stdio.js";
export type {
  StdioDaemonOptions,
  ByteTransport,
} from "./daemon-stdio.js";

// Static preview-bundle reader (Phase 1 of #38).
export {
  readPreviewBundle,
  parsePreviewBundle,
  bundleToCandidates,
  previewToCandidate,
  previewHasNoRender,
  rawPreviewIdForEntry,
  mergeCandidateRenders,
  loadPreviewBundle,
  catalogTokensFromBundle,
  themeTokenSetsFromBundle,
} from "./bundle.js";
export type {
  BundleThemeTokens,
  PreviewBundle,
  BundleManifest,
  PreviewsFile,
  PreviewEntry,
  PreviewCapture,
  ComponentIdResolver,
  ResolvedComponentId,
} from "./bundle.js";

export { renderCandidate, toCandidateRender } from "./candidate.js";
export type {
  RenderCandidateOptions,
  ToCandidateOptions,
} from "./candidate.js";

export {
  SpawnComposePreviewCli,
  parseShow,
  normalizeSemantics,
  themeFromUiMode,
  themeFromName,
  themeForPreview,
  sizeFromParams,
  stateFromParams,
} from "./cli.js";
export type {
  ComposePreviewCli,
  SpawnOptions,
  RenderRequest,
  RenderedPreview,
  ShowEntry,
  PreviewParams,
  RawSemantics,
  RawSemanticsNode,
  ReadFile,
} from "./cli.js";

export { readPngSize } from "./png.js";
export type { PngSize } from "./png.js";

export { execFileRunner, isNotFound } from "./exec.js";
export type { CommandRunner, RunOptions, RunResult } from "./exec.js";

export {
  CandidateError,
  MissingComposePreviewError,
  NoPreviewsError,
  RenderError,
  InvalidBundleError,
  NotImplementedError,
  UnsupportedComposePreviewVersionError,
} from "./errors.js";

export {
  parseCliVersion,
  compareCliVersions,
  isBelowMinimum,
  MINIMUM_COMPOSE_PREVIEW_VERSION,
} from "./cli-version.js";
export type { CliVersion } from "./cli-version.js";
