/**
 * `@design-parity/action` — the integration layer.
 *
 * Wires the resolver, the `source → adapter` registry, the candidate renderer,
 * the diff engine (+ checks), and the parity-direction policy into a single
 * {@link orchestrate} pipeline, and renders the aggregate {@link ParityReport}
 * for the PR surface, which it also posts/updates as a single PR comment.
 */
export { createAdapterRegistry } from "./registry.js";
export type { AdapterRegistry, RegistryOptions } from "./registry.js";

export { orchestrate } from "./orchestrate.js";
export type {
  OrchestrateOptions,
  CandidateProvider,
  ComponentResult,
  ComponentStatus,
  ParityReport,
} from "./orchestrate.js";

export {
  buildCandidateProvider,
  loadPrecomputed,
  precomputedSource,
  providerFromSource,
  resolveBundlePaths,
} from "./candidate.js";
export type { BuildProviderOptions } from "./candidate.js";

export { resolveRunConfig } from "./config.js";
export type { RunConfig } from "./config.js";

export {
  renderReport,
  renderBootstrapNotice,
  REPORT_MARKER,
  CMP_PROMOTION,
} from "./report.js";

export { selectMode } from "./mode.js";
export type { ActionMode, ModeInputs } from "./mode.js";

export { runReverse } from "./reverse.js";
export type { ReverseIO } from "./reverse.js";

export { pushBack, decidePushBack } from "./pushback.js";
export type {
  PushBackGate,
  PushBackOptions,
  PushBackReport,
  PushBackComponent,
  PushBackSkip,
  PushBackError,
  PushedImage,
} from "./pushback.js";

export {
  baselineSummary,
  renderBaselineIndex,
  writeBaselineArtifacts,
} from "./baseline.js";
export type {
  BaselineArtifacts,
  BaselineComponent,
  BaselineMeta,
  BaselineSummary,
} from "./baseline.js";

// GitHub surface
export { postReport } from "./github/surface.js";
export type {
  GitHubCommentClient,
  IssueComment,
  PostOutcome,
} from "./github/surface.js";
export { GitHubRest } from "./github/rest.js";
export type { GitHubRestOptions, RepoRef, FetchLike } from "./github/rest.js";
export {
  componentsForChangedFiles,
  filePathOf,
} from "./github/changed-components.js";
export { checkConclusion, exitCode } from "./github/conclusion.js";
export type { CheckConclusion } from "./github/conclusion.js";
export { publishBaseline, execGit } from "./github/publish.js";
export type {
  GitRunner,
  GitResult,
  PublishOptions,
  PublishResult,
} from "./github/publish.js";
