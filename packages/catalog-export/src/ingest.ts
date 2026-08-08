/**
 * Build a {@link Catalog} from normalized, per-component inputs.
 *
 * The heavy lifting — turning raw `compose-preview` data products into
 * {@link Finding}s, a {@link SemanticTree}, and {@link DesignTokens} — is the job
 * of `@design-parity/candidate` (`nativeFindings`, `semanticsToSemanticTree`,
 * `composeThemeToTokens`). This module takes those already-normalized pieces and
 * assembles the catalog: it attaches each component's greenline layer and, when
 * the catalog's system token set isn't supplied, lifts it from the richest
 * component semantics' `themeTokens`. Pure — no I/O, no renderer.
 */
import type {
  DesignTokens,
  Finding,
  SemanticTree,
} from "@design-parity/core";

import { buildGreenlines } from "./greenlines.js";
import { buildRedlines } from "./redlines.js";
import { buildWireframeSvg } from "./wireframe.js";
import type {
  Catalog,
  CatalogComponent,
  CatalogImage,
  CatalogMeta,
  ComponentReference,
} from "./types.js";

/** Normalized input for one component (the output of candidate's mappers). */
export interface ComponentSource {
  componentId: string;
  /** Top-level section (tab) this component belongs to; see {@link CatalogComponent.section}. */
  section?: string;
  group?: string;
  caption?: string;
  reference?: ComponentReference;
  /** Family handle for {@link reference}; see {@link CatalogComponent.referenceSet}. */
  referenceSet?: string;
  /** Ideal capture image(s) — one per state/theme/size. */
  ideal: CatalogImage[];
  /** Layout/wireframe image(s) from `compose/semantics-wireframe`. */
  layout?: CatalogImage[];
  /** Per-component resolved tokens (padding / radius / type used). */
  tokens?: DesignTokens;
  /** Component semantic tree (carries bounds + per-node tokens + themeTokens). */
  semantics?: SemanticTree;
  /** Renderer-native a11y / contrast / i18n findings → issue greenlines. */
  findings?: Finding[];
}

/** Assemble one {@link CatalogComponent}, computing its greenline layer. */
export function buildComponent(source: ComponentSource): CatalogComponent {
  if (source.ideal.length === 0) {
    throw new Error(
      `catalog-export: component '${source.componentId}' has no ideal images`,
    );
  }
  const component: CatalogComponent = {
    componentId: source.componentId,
    variants: source.layout
      ? { ideal: source.ideal, layout: source.layout }
      : { ideal: source.ideal },
    greenlines: buildGreenlines(source.findings, source.semantics),
    redlines: buildRedlines(source.semantics),
  };
  if (source.section !== undefined) component.section = source.section;
  if (source.group !== undefined) component.group = source.group;
  if (source.caption !== undefined) component.caption = source.caption;
  if (source.reference !== undefined) component.reference = source.reference;
  if (source.referenceSet !== undefined) component.referenceSet = source.referenceSet;
  if (source.tokens !== undefined) component.tokens = source.tokens;
  if (source.semantics !== undefined) component.semantics = source.semantics;
  const wireframeSvg = buildWireframeSvg(source.semantics);
  if (wireframeSvg !== undefined) component.wireframeSvg = wireframeSvg;
  return component;
}

/**
 * Assemble a whole {@link Catalog}. When `themeTokens` is omitted, it is lifted
 * from the first component whose semantics carry `themeTokens` (the resolved
 * `compose/theme` of the system) — so the system token set comes from the code,
 * not a hand-maintained list.
 */
export function buildCatalog(
  meta: CatalogMeta,
  sources: readonly ComponentSource[],
  themeTokens?: DesignTokens,
): Catalog {
  const components = sources.map(buildComponent);
  const resolvedTokens =
    themeTokens ??
    components.find((c) => c.semantics?.themeTokens)?.semantics?.themeTokens;
  const catalog: Catalog = { meta, components };
  if (resolvedTokens) catalog.themeTokens = resolvedTokens;
  return catalog;
}
