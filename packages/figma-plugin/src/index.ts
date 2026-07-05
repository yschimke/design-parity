/**
 * `@design-parity/figma-plugin` — the in-Figma client for the code → design
 * flow.
 *
 * This package's public surface is the **pure planner**: given a
 * `@design-parity/catalog-export` {@link CatalogManifest}, it produces an
 * {@link ImportPlan} describing the sticker sheet + variable collection to
 * create on a Figma canvas. The main-thread **scene builder** ({@link applyImport})
 * is here too — it takes an injected `FigmaApi`, so it runs headlessly in tests;
 * only the thin `figma/` bootstrap depends on the `figma` global.
 */
export {
  buildImportPlan,
  resolveImageUrl,
  imageKey,
} from "./plan.js";
export { readDtcgTokensLite } from "./dtcg.js";
export { buildDesignMap, figmaRef, componentIdToCode } from "./designMap.js";
export type { DesignMapOptions } from "./designMap.js";
export { planToSvg } from "./preview.js";
export {
  severityHex,
  severityRgb,
  redlineRgb,
  redlineLabel,
  REDLINE_HEX,
} from "./annotations.js";
export type { Rgb } from "./annotations.js";
export { applyImport, hexToRgba } from "./scene.js";
export type {
  FigmaApi,
  FigmaNode,
  FigmaPaint,
  FigmaRgba,
  FigmaVariableValue,
  FigmaVariableCollectionNode,
  FigmaVariableNode,
  FetchedImage,
  ImportResult,
} from "./scene.js";
export type {
  ImportPlan,
  PlanOptions,
  PlannedGroup,
  PlannedComponent,
  PlannedImage,
} from "./plan.js";
