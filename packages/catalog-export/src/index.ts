/**
 * `@design-parity/catalog-export` — code → importable design artifacts.
 *
 * Turns a rendered Compose component system into a sticker-sheet **catalog**:
 * per-component renders in two variants (ideal + layout), a W3C DTCG token set,
 * a Figma variable-collection projection, and an accessibility **greenline**
 * annotation layer — laid out on disk for Figma / Stitch / Claude Design import.
 *
 * The pipeline is code-led: every value comes from the renderer's own data
 * products (via `@design-parity/candidate`'s mappers), so the catalog is correct
 * by construction. Published design kits are seed/reference only (see
 * `docs/design-artifacts/REFERENCE_KITS.md`). Depends only on
 * `@design-parity/core`.
 */
export type {
  Catalog,
  CatalogComponent,
  CatalogDisplay,
  CatalogMeta,
  CatalogScreen,
  CatalogTheme,
  ComponentReference,
  ComponentVariants,
  CatalogImage,
  Greenline,
  Redline,
  RedlinePadding,
} from "./types.js";

export { buildCatalog, buildComponent } from "./ingest.js";
export type { ComponentSource } from "./ingest.js";

export {
  INTERACTIVE_ROLES,
  MIN_TOUCH_TARGET_DP,
  buildGreenlines,
  findingToGreenline,
  findingsToGreenlines,
  specGreenlines,
} from "./greenlines.js";

export { buildRedlines } from "./redlines.js";

export {
  ANNOTATION_SCHEMA,
  buildAnnotationManifest,
  componentAnnotations,
  isEmptyAnnotationManifest,
  referenceAnnotations,
  treeAnnotations,
  withReferenceAnnotations,
} from "./annotations.js";
export type {
  AnnotationBounds,
  AnnotationKind,
  AnnotationManifest,
  DesignAnnotation,
  TypeUnit,
} from "./annotations.js";

export {
  imagePath,
  livePreviewUrl,
  slug,
  themeTokensPath,
  toCatalogManifest,
  wireframePath,
} from "./manifest.js";
export { buildWireframeSvg } from "./wireframe.js";
export type {
  CatalogManifest,
  CatalogManifestComponent,
  CatalogManifestImage,
  CatalogManifestTheme,
  ManifestOptions,
  PreviewServerOptions,
  VariantKind,
} from "./manifest.js";

export { stickerId } from "./manifest.js";
export { toFigmaVariables } from "./figma.js";
export type {
  FigmaVariable,
  FigmaVariableCollection,
  FigmaVariableType,
} from "./figma.js";

export { writeCatalog } from "./write.js";
export type { WriteOptions, WriteResult } from "./write.js";

export { catalogFromCandidates, screenGraphIssues } from "./spec.js";
export type {
  CatalogSpec,
  CatalogSpecComponent,
  CatalogSpecGroup,
  FromCandidatesOptions,
  FromCandidatesResult,
} from "./spec.js";
