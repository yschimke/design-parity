/**
 * `@design-parity/core` — shared contracts for the design-parity bot.
 *
 * Downstream packages (adapters, candidate, diff, resolver, action) depend on
 * this package and nothing else for their shared vocabulary.
 */
export type {
  DesignSource,
  LinkMethod,
  Theme,
  Image,
  TypographyToken,
  DesignTokens,
  Bounds,
  SemanticNode,
  SemanticTree,
  DesignReference,
  CandidateRender,
  AdapterContext,
  ReferenceAdapter,
  Correspondence,
  VerdictStatus,
  FindingKind,
  Severity,
  Finding,
  Verdict,
  ParityDirection,
  ResolvedDirection,
  ParityConfig,
} from "./types.js";

export type {
  DesignMap,
  DesignMapEntry,
  ValidationResult,
} from "./design-map.js";

export {
  designMapSchema,
  designMapSchemaPath,
  validateDesignMap,
  loadDesignMap,
  findByCode,
} from "./design-map.js";
