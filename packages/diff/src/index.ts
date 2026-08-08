/**
 * `@design-parity/diff` — the source-agnostic diff engine.
 *
 * Consume a `(DesignReference, CandidateRender)` pair (from any adapter +
 * the candidate renderer) and emit a deterministic {@link Verdict}, a markdown
 * summary, and reference/candidate/diff triptychs. a11y + i18n lead; tokens,
 * semantics, and raw visual diff follow (docs/PRINCIPLES.md).
 */
export { diff } from "./diff.js";
export type { DiffOptions, DiffResult, Triptych } from "./diff.js";

export { defaultDiffConfig, resolveConfig } from "./config.js";
export type { DiffConfig } from "./config.js";

export { defaultChecks } from "./checks.js";
export type { ChecksProvider, ChecksInput, ChecksConfig } from "./checks.js";

export { collectTokens, diffTokens } from "./tokens.js";
export { diffDesignSystem } from "./design-system.js";
export type { DesignSystemOptions } from "./design-system.js";
export { diffSemantics, referenceThemes, candidateThemes } from "./semantic.js";
export { diffLayout, flattenPlaced } from "./layout.js";
export type { PlacedElement } from "./layout.js";
export {
  propertyConflicts,
  unpairableFinding,
  depictionFinding,
} from "./pairing.js";
export type { PropertyConflict } from "./pairing.js";
export { diffImagePair, imageKey } from "./visual.js";
export type { VisualResult } from "./visual.js";
export { renderSummary } from "./summary.js";
