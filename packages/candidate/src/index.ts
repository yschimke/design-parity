/**
 * `@design-parity/candidate` — the candidate side of parity.
 *
 * Shells out to the upstream `compose-preview` CLI (rendering is **not**
 * reimplemented here) and normalizes its output into a
 * {@link CandidateRender}. Depends only on `@design-parity/core`.
 */
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
} from "./errors.js";
