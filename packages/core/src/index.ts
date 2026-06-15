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
  RefVariant,
  VerdictStatus,
  FindingKind,
  Severity,
  Finding,
  Verdict,
  ParityDirection,
  ResolvedDirection,
  MaturityRung,
  ParityConfig,
  CanvasTarget,
  CanvasWriteResult,
  CanvasWriter,
} from "./types.js";

export type {
  DesignMap,
  DesignMapEntry,
  TokenAliasMap,
  ValidationResult,
} from "./design-map.js";

export {
  designMapSchema,
  designMapSchemaPath,
  validateDesignMap,
  loadDesignMap,
  findByCode,
  entryRefs,
} from "./design-map.js";

export type { CanonicalSize } from "./size.js";
export {
  CANONICAL_SIZES,
  SIZE_BREAKPOINTS,
  sizeForWidth,
  normalizeSize,
} from "./size.js";
