/**
 * `@design-parity/baseline` — maturity detection + opinionated bootstrap.
 *
 * Used at setup/bootstrap time (interactive only) to classify a repo's
 * design-system maturity, materialize a concrete parity direction, and — for a
 * repo with no design system — generate a committed baseline (tokens, starter
 * design-map, check config). Nothing here runs on the unattended Action path.
 */
export { detectMaturity } from "./detect.js";
export type { MaturitySignal, MaturityResult } from "./detect.js";
/** Re-exported for convenience; the canonical definition lives in `core`. */
export type { MaturityRung } from "@design-parity/core";

export {
  directionForRung,
  parityConfigForRung,
} from "./direction.js";

export { materialBaselineTokens } from "./tokens.js";

export { defaultCheckConfig } from "./checks.js";

export {
  discoverCodeComponents,
  seedDesignMap,
} from "./seed.js";
export type { DiscoveredComponent } from "./seed.js";

export {
  CONFIG_FILE,
  TOKENS_FILE,
  CHECKS_FILE,
  DESIGN_MAP_FILE,
} from "./artifacts.js";

export {
  planBootstrap,
  applyBootstrap,
} from "./bootstrap.js";
export type {
  PlannedArtifact,
  BootstrapPlan,
  PlanOptions,
  ApplyOptions,
  ApplyResult,
} from "./bootstrap.js";
