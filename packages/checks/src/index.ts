/**
 * `@design-parity/checks` — deterministic accessibility + internationalization
 * spec checks over a `(DesignReference, CandidateRender)` pair.
 *
 * These are the high-value, spec-backed findings the verdict leads with
 * (docs/PRINCIPLES.md Principle 2). Every check is a pure function with no
 * network or model call: it reads committed thresholds (see `./thresholds`) and
 * the candidate's rendered semantics, and emits `Finding[]` from
 * `@design-parity/core` (`kind: "contrast" | "a11y" | "i18n"`).
 */
export { runChecks, runA11yChecks, runI18nChecks } from "./run.js";

export {
  checkContrast,
  checkTouchTargets,
  checkSemantics,
} from "./a11y.js";

export {
  checkTextExpansion,
  checkLocaleFormatting,
  checkRtlMirroring,
  checkHardcodedStrings,
  estimateWidth,
} from "./i18n.js";

export type { ChecksConfig, ResolvedConfig } from "./config.js";
export { resolveConfig } from "./config.js";

export type { ValidationResult } from "./load-config.js";
export {
  CHECKS_CONFIG_FILENAME,
  defaultChecksConfig,
  checksConfigSchema,
  checksConfigSchemaPath,
  validateChecksConfig,
  loadChecksConfig,
  loadChecksConfigOrDefault,
} from "./load-config.js";

export {
  contrastRatio,
  relativeLuminance,
  parseColor,
  flatten,
  round2,
  type Rgba,
} from "./color.js";

export * as thresholds from "./thresholds.js";
