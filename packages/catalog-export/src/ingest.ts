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
  CatalogTheme,
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
  /** Stated reason there is no {@link reference}; see {@link CatalogComponent.noReference}. */
  noReference?: string;
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
  if (source.noReference !== undefined) component.noReference = source.noReference;
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
 *
 * `themes` are the system's ALTERNATE named themes, each with its own token set
 * ({@link CatalogTheme}). They are never lifted: a component's semantics record
 * the one theme it was rendered under, so the caller — which knows which render
 * belongs to which declared theme — supplies them. An entry with a blank id or an
 * empty token set is dropped rather than published as a theme a consumer can
 * select and find nothing behind, and a repeated id keeps its first entry so one
 * theme can never be published twice.
 */
export function buildCatalog(
  meta: CatalogMeta,
  sources: readonly ComponentSource[],
  themeTokens?: DesignTokens,
  themes?: readonly CatalogTheme[],
): Catalog {
  const components = sources.map(buildComponent);
  const resolvedTokens =
    themeTokens ??
    components.find((c) => c.semantics?.themeTokens)?.semantics?.themeTokens;
  const catalog: Catalog = { meta, components };
  if (resolvedTokens) catalog.themeTokens = resolvedTokens;
  const named = usableThemes(themes);
  if (named.length > 0) catalog.themes = named;
  return catalog;
}

/** Whether a token set says anything at all. */
function hasTokens(tokens: DesignTokens | undefined): boolean {
  return (
    !!tokens &&
    Object.values(tokens).some((group) => group && Object.keys(group).length > 0)
  );
}

/** Drop unusable / duplicate themes, preserving declaration order. */
function usableThemes(
  themes: readonly CatalogTheme[] | undefined,
): CatalogTheme[] {
  const seen = new Set<string>();
  const out: CatalogTheme[] = [];
  for (const theme of themes ?? []) {
    if (!theme.id || seen.has(theme.id) || !hasTokens(theme.tokens)) continue;
    seen.add(theme.id);
    out.push(theme);
  }
  return out;
}
