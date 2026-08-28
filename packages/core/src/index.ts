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
  ImageGutter,
  TypographyToken,
  ReferencePropertyType,
  ReferenceProperty,
  DesignTokens,
  Bounds,
  SemanticNode,
  SemanticTree,
  DesignReference,
  CandidateRender,
  AdapterContext,
  ReferenceAdapter,
  SiblingTarget,
  Correspondence,
  RefVariant,
  PreviewIdVariant,
  VerdictStatus,
  FindingKind,
  Severity,
  Finding,
  Verdict,
  ParityDirection,
  ResolvedDirection,
  MaturityRung,
  ParityConfig,
  ParityTokenPolicy,
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
  findAllByCode,
  entryRefs,
  entryPreviewIds,
} from "./design-map.js";
export type { KnownDifferenceScope } from "./design-map.js";

export type { DtcgReadResult } from "./dtcg.js";
export {
  dtcgTokensSchema,
  dtcgTokensSchemaPath,
  validateDtcgTokens,
  readDtcgTokens,
  loadDtcgTokens,
  tokensToDtcg,
} from "./dtcg.js";

export type {
  MaterialColorRole,
  MaterialTypeRole,
  MaterialShapeRole,
} from "./material-roles.js";
export {
  MATERIAL_COLOR_ROLES,
  MATERIAL_TYPE_ROLES,
  MATERIAL_SHAPE_ROLES,
  materialColorRole,
  materialTypeRole,
  materialShapeRole,
} from "./material-roles.js";

export type { CanonicalSize } from "./size.js";
export {
  CANONICAL_SIZES,
  SIZE_BREAKPOINTS,
  sizeForWidth,
  normalizeSize,
} from "./size.js";
