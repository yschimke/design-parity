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
export {
  buildFrameSpec,
  defaultComponentId,
  suggestKind,
  specToIssueBody,
  specToJson,
  A11Y_CONTRACT,
} from "./spec.js";
export type {
  FrameRead,
  FrameLayout,
  FrameSpec,
  SpecKind,
  SpecOptions,
  A11yContract,
} from "./spec.js";
export {
  buildRenderUrl,
  encodeSegment,
  nonBlankOverrides,
  isSupportedOverrideKey,
  knobKey,
  knobValue,
  withRenderSize,
  SUPPORTED_OVERRIDE_KEYS,
  KNOB_PREFIX,
} from "./render.js";
export type {
  RenderSource,
  RenderFormat,
  OverrideKey,
  KnobKind,
} from "./render.js";
export {
  stampRenderSource,
  readRenderSource,
  hasRenderSource,
  refreshUrl,
} from "./provenance.js";
export {
  placeLiveRender,
  placeLiveSvg,
  refreshLiveRender,
  refreshLiveSvg,
  planRefresh,
  isLiveRender,
  LIVE_ROLE,
} from "./live.js";
export type { PlaceLiveOptions, LiveRenderSize, RefreshJob } from "./live.js";
export { knobControls, EDITOR_AXES } from "./editor.js";
export type { KnobControl, AxisControl } from "./editor.js";
export {
  previewsUrl,
  parsePreviewsResponse,
  servesOverrides,
  seedKey,
  overrideValueText,
  declarationText,
  knobOverrides,
  renderSourceForPreview,
  SERVE_SCHEMA_V2,
} from "./previews.js";
export type {
  PreviewsResponse,
  Preview,
  OverrideDeclaration,
  OverrideValue,
  RenderSourceOptions,
} from "./previews.js";
export {
  buildSlotsUrl,
  parseSlotsResponse,
  slotWidth,
  slotHeight,
} from "./slots.js";
export type { PreviewSlots, PreviewSlot, SlotBounds } from "./slots.js";
export {
  placeSlots,
  fillSlot,
  slotSizeAxes,
  isSlotFrame,
  slotName,
  slotFilledWith,
  slotContainerPreviewId,
  SLOT_ROLE,
  SLOT_CONTAINER_ROLE,
} from "./structure.js";
export type { PlacedSlot } from "./structure.js";
export {
  DEFAULT_CATALOGS,
  normalizeBaseUrl,
  hydrateRegistry,
  dehydrateRegistry,
  registerCatalog,
  removeCatalog,
  selectCatalog,
  findCatalog,
  selectedCatalog,
} from "./catalogs.js";
export type {
  CatalogSource,
  CatalogRegistry,
  StoredRegistry,
  RegisterInput,
} from "./catalogs.js";
export {
  indexCatalog,
  groupComponents,
  selectCatalogImage,
  selectCatalogWireframe,
  selectCatalogDesignVector,
  componentSetCells,
  PROP_AXIS_PREFIX,
} from "./catalogPick.js";
export { svgRasterHrefs, inlineSvgRasters } from "./svgRaster.js";
export {
  normalizeSvgRects,
  svgFontRequests,
  svgTokenAnnotations,
  chooseAvailableFont,
  inferAutoLayout,
} from "./nativeSvg.js";
export type {
  SvgFontRequest,
  SvgTokenAnnotation,
  AvailableFont,
  LayoutBox,
  InferredAutoLayout,
} from "./nativeSvg.js";
export type {
  CatalogIndex,
  ComponentGroup,
  PickComponent,
  PickAxis,
  PickSelection,
  PickedImage,
  ComponentSetCell,
} from "./catalogPick.js";
export {
  placeCatalogPng,
  placeCatalogSvg,
  placeCatalogComponentSet,
  isCatalogInsert,
  INSERT_ROLE,
} from "./insert.js";
export type {
  InsertOptions,
  InsertPngOptions,
  InsertSize,
  InsertSetCell,
  InsertSetOptions,
} from "./insert.js";
export { parseLivePreview, liveBridgeTarget, matchPreview } from "./liveBridge.js";
export type { LiveBridgeTarget } from "./liveBridge.js";
export { stripLocalRoot, rewriteManifestAssets } from "./localCatalog.js";
export { diagnoseServerLoad } from "./serverHelp.js";
export type { ServerHelp, ServerIssue, ServerLoadOutcome } from "./serverHelp.js";
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
export { applyImport, hexToRgba, STAMP, ROLE } from "./scene.js";
export type { ImportOptions } from "./scene.js";
export { reconcile } from "./reconcile.js";
export type { ExistingCard, ReconcileActions } from "./reconcile.js";
export { resolveDirection, REFERENCE_PAGE } from "./direction.js";
export type { ParityDirection } from "./direction.js";
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
