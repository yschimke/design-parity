/**
 * `@design-parity/action` — the integration layer.
 *
 * Wires the resolver, the `source → adapter` registry, the candidate renderer,
 * the diff engine (+ checks), and the parity-direction policy into a single
 * {@link orchestrate} pipeline, and renders the aggregate {@link ParityReport}
 * for the PR surface. The GitHub Action surface (read PR → post/update comment)
 * builds on this core.
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

export { resolveRunConfig } from "./config.js";
export type { RunConfig } from "./config.js";

export { renderReport, REPORT_MARKER } from "./report.js";
