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
  Image,
  SemanticTree,
} from "@design-parity/core";

import { buildGreenlines } from "./greenlines.js";
import type {
  Catalog,
  CatalogComponent,
  CatalogMeta,
  ComponentReference,
} from "./types.js";

/** Normalized input for one component (the output of candidate's mappers). */
export interface ComponentSource {
  componentId: string;
  group?: string;
  caption?: string;
  reference?: ComponentReference;
  /** Ideal capture image(s) — one per state/theme/size. */
  ideal: Image[];
  /** Layout/wireframe image(s) from `compose/semantics-wireframe`. */
  layout?: Image[];
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
  };
  if (source.group !== undefined) component.group = source.group;
  if (source.caption !== undefined) component.caption = source.caption;
  if (source.reference !== undefined) component.reference = source.reference;
  if (source.tokens !== undefined) component.tokens = source.tokens;
  if (source.semantics !== undefined) component.semantics = source.semantics;
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
