/**
 * Build a {@link Catalog} from a rendered preview's {@link CandidateRender}s and
 * a catalog **spec** — the bridge from "a module was rendered" to "here is the
 * importable sticker sheet".
 *
 * The spec ({@link CatalogSpec}, the committed `catalog.spec.json` next to a
 * catalog module) declares the inventory: which preview function fills which
 * component slot, its group, caption, and seed-kit reference. This module is the
 * pure join: match each spec component to the candidate whose preview produced
 * it (by function name), and assemble the {@link ComponentSource}s. The caller
 * obtains the `CandidateRender[]` however it likes — `@design-parity/candidate`'s
 * `loadPreviewBundle` for a static render, or the live daemon source.
 *
 * `CandidateRender` is a `@design-parity/core` type, so this stays core-only.
 */
import type { CandidateRender, DesignTokens } from "@design-parity/core";

import { buildCatalog } from "./ingest.js";
import type { ComponentSource } from "./ingest.js";
import type { CatalogImage } from "./types.js";
import type {
  Catalog,
  CatalogDisplay,
  CatalogScreen,
  ComponentReference,
} from "./types.js";

/**
 * One extra **state variant** of a component: its own `@Preview` function whose
 * render folds onto the parent sticker, tagged with `state`. Lets one component
 * carry its default plus every state (pressed / focused / disabled / off / …) —
 * the default is the grid hero, the variants are secondary previews in the
 * single-component view.
 */
export interface CatalogSpecVariant {
  /** State this variant renders, e.g. `"pressed"`, `"focused"`, `"disabled"`. */
  state?: string;
  /**
   * Extra named variant axes for this render beyond `state` — e.g.
   * `{ content: "icon+label" }`, `{ density: "compact" }`. Each becomes a
   * variant property on the component set alongside `state`/`theme`/`size`, so a
   * component can vary along content/config axes, not only its state.
   */
  props?: Record<string, string>;
  /** The `@Preview` **function name** that renders this variant. */
  preview: string;
  caption?: string;
}

/** A short label for a variant, for coverage reports: its state and/or props. */
function variantLabel(variant: CatalogSpecVariant): string {
  const parts = [
    ...(variant.state ? [variant.state] : []),
    ...Object.entries(variant.props ?? {}).map(([k, v]) => `${k}=${v}`),
  ];
  return parts.join(", ") || variant.preview;
}

/** One component slot in a {@link CatalogSpec} group. */
export interface CatalogSpecComponent {
  /** Stable component id, e.g. `"Button/Filled"`. */
  componentId: string;
  /** The `@Preview` **function name** that renders it, e.g. `"FilledButton"`. */
  preview: string;
  caption?: string;
  /** Published-kit reference (URL or `figma:` handle) for the seed import. */
  reference?: ComponentReference;
  /** Family handle for {@link reference}; see {@link CatalogComponent.referenceSet}. */
  referenceSet?: string;
  /**
   * Extra state renders folded onto this component (see {@link CatalogSpecVariant}).
   * The default `preview` stays the grid hero; each variant's images are appended
   * to `ideal`, re-tagged with the variant's `state`.
   */
  variants?: CatalogSpecVariant[];
}

/** A named group of components in a {@link CatalogSpec}. */
export interface CatalogSpecGroup {
  name: string;
  components: CatalogSpecComponent[];
}

/** The committed `catalog.spec.json` for a design-system catalog module. */
export interface CatalogSpec {
  system: string;
  title: string;
  library?: string[];
  groups: CatalogSpecGroup[];
  /**
   * Optional screen graph: which components are main screens and their related
   * secondaries/dialogs, for a per-screen import. Additive — every id references
   * a component declared in {@link CatalogSpec.groups}; absent ⇒ flat catalog.
   */
  screens?: CatalogScreen[];
  /**
   * Optional presentation hints for a viewer/index — the stage surface the
   * stickers are drawn for and the hero preview to feature. Carried onto the
   * catalog's {@link CatalogMeta.display}. Additive; absent ⇒ consumer defaults.
   */
  display?: CatalogDisplay;
}

/**
 * The screen-graph references (`screen.id` / `related[]`) that don't name a
 * component declared in any group — a hand-authored `catalog.spec.json` typo or
 * a stale id after a rename. Pure; empty ⇒ the graph is sound. The generator
 * warns on these rather than dropping them silently.
 */
export function screenGraphIssues(spec: CatalogSpec): string[] {
  const declared = new Set(
    spec.groups.flatMap((g) => g.components.map((c) => c.componentId)),
  );
  const issues: string[] = [];
  for (const screen of spec.screens ?? []) {
    if (!declared.has(screen.id)) issues.push(`screen "${screen.id}" is not a declared component`);
    for (const related of screen.related ?? []) {
      if (!declared.has(related)) {
        issues.push(`screen "${screen.id}" relates to undeclared component "${related}"`);
      }
    }
  }
  return issues;
}

/**
 * The `@Preview` function name a spec component matches on. Prefers the
 * candidate's {@link CandidateRender.functionName} — the stable identity the
 * bundle reader carries — so a function's theme/size multipreview variants
 * (`FilledButton_Light`, `FilledButton_Dark`) all resolve to one key
 * (`FilledButton`). Falls back to the dotted-id tail for hand-authored
 * candidates with no function name; that tail keeps any `_<mode>` suffix, which
 * is why the bundle path sets `functionName`.
 */
function functionOf(candidate: CandidateRender): string {
  if (candidate.functionName) return candidate.functionName;
  const id = candidate.previewId ?? candidate.componentId;
  return id.split(".").pop() ?? id;
}

/** Fold a function's theme/size variants into one render: concatenate every
 *  variant's images and keep a light-themed semantics tree (the token/greenline
 *  reader keys off one). Mirrors `mergeCandidateRenders` but stays core-only so
 *  catalog-export keeps its single `@design-parity/core` dependency. */
function mergeByFunction(
  a: CandidateRender,
  b: CandidateRender,
): CandidateRender {
  const semantics =
    a.semantics.theme === "light"
      ? a.semantics
      : b.semantics.theme === "light"
        ? b.semantics
        : a.semantics;
  const merged: CandidateRender = {
    componentId: a.componentId,
    images: [...catalogImages(a), ...catalogImages(b)],
    semantics,
  };
  if (a.previewId ?? b.previewId) merged.previewId = a.previewId ?? b.previewId;
  if (a.functionName ?? b.functionName)
    merged.functionName = a.functionName ?? b.functionName;
  return merged;
}

/** Attach the renderer's authoritative preview id without widening core Image. */
function catalogImages(candidate: CandidateRender): CatalogImage[] {
  const previewId = candidate.previewId ?? candidate.componentId;
  return candidate.images.map((image) => ({
    ...image,
    previewId: (image as CatalogImage).previewId ?? previewId,
  }));
}

export interface FromCandidatesOptions {
  /** `compose-preview` version, recorded as provenance. */
  renderer?: string;
  /** Generation timestamp; defaults to now (ISO-8601). */
  generatedAt?: string;
  /** Explicit system token set; otherwise lifted from a component's semantics. */
  themeTokens?: DesignTokens;
}

export interface FromCandidatesResult {
  catalog: Catalog;
  /** Spec components with no matching rendered preview (a coverage gap). */
  missing: string[];
  /**
   * Components that rendered but carry no semantics tree — the render produced
   * pixels but the `*.semantics.json` sidecar is absent (e.g. a best-effort
   * `bundle pack --with-semantics` whose daemon/semantics capture silently
   * failed). Without semantics there are no token, contrast, or greenline data,
   * so a publishing job should treat this as an incomplete render, not ship it.
   */
  withoutSemantics: string[];
}

/** A semantics tree carries real signal (not the empty `{ root: {} }` fallback). */
function hasSemantics(candidate: CandidateRender): boolean {
  const tree = candidate.semantics;
  if (!tree) return false;
  if (tree.themeTokens) return true;
  const r = tree.root;
  return Boolean(
    r &&
      ((r.children && r.children.length > 0) || r.role || r.label || r.bounds || r.tokens),
  );
}

/**
 * Join rendered {@link CandidateRender}s to a {@link CatalogSpec} into a
 * {@link Catalog}. Each spec component is matched to the candidate whose preview
 * **function name** equals its `preview`; its captures become the `ideal`
 * variant and its semantics carry the bounds/tokens the greenline + token export
 * read. Components with no rendered preview are reported in `missing` rather than
 * dropped silently, so a coverage gap is visible.
 *
 * The `layout` (wireframe) variant and native a11y findings are not part of a
 * static capture bundle — they come from the daemon's `compose/semantics-wireframe`
 * and `a11y/*` products and can be layered on by a daemon-backed caller.
 */
export function catalogFromCandidates(
  candidates: readonly CandidateRender[],
  spec: CatalogSpec,
  opts: FromCandidatesOptions = {},
): FromCandidatesResult {
  // Fold each function's theme/size multipreview variants into one render, so a
  // spec component picks up every variant's image (light + dark, small + large)
  // as captures of the same sticker rather than the last one winning.
  const byFunction = new Map<string, CandidateRender>();
  for (const candidate of candidates) {
    const fn = functionOf(candidate);
    const existing = byFunction.get(fn);
    byFunction.set(fn, existing ? mergeByFunction(existing, candidate) : candidate);
  }

  const sources: ComponentSource[] = [];
  const missing: string[] = [];
  const withoutSemantics: string[] = [];
  for (const group of spec.groups) {
    for (const component of group.components) {
      const candidate = byFunction.get(component.preview);
      if (!candidate || candidate.images.length === 0) {
        missing.push(component.componentId);
        continue;
      }
      if (!hasSemantics(candidate)) withoutSemantics.push(component.componentId);
      // Fold the component's state `variants` (pressed / focused / disabled / …)
      // onto the default render: the default images stay first (the grid hero),
      // each variant's images are appended re-tagged with its `state` so the
      // single-component view can show them as secondary previews. A variant
      // preview that didn't render is reported as missing, keyed by state.
      const ideal = catalogImages(candidate);
      for (const variant of component.variants ?? []) {
        const variantCandidate = byFunction.get(variant.preview);
        if (!variantCandidate || variantCandidate.images.length === 0) {
          missing.push(`${component.componentId} [${variantLabel(variant)}]`);
          continue;
        }
        for (const image of catalogImages(variantCandidate)) {
          const tagged = { ...image };
          if (variant.state !== undefined) tagged.state = variant.state;
          if (variant.props) tagged.props = { ...image.props, ...variant.props };
          ideal.push(tagged);
        }
      }
      const source: ComponentSource = {
        componentId: component.componentId,
        group: group.name,
        ideal,
      };
      if (component.caption !== undefined) source.caption = component.caption;
      if (component.reference !== undefined) source.reference = component.reference;
      if (component.referenceSet !== undefined) source.referenceSet = component.referenceSet;
      if (candidate.semantics) source.semantics = candidate.semantics;
      sources.push(source);
    }
  }

  const meta = {
    system: spec.system,
    title: spec.title,
    ...(spec.library ? { library: spec.library } : {}),
    ...(opts.renderer ? { renderer: opts.renderer } : {}),
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    ...(spec.screens ? { screens: spec.screens } : {}),
    ...(spec.display ? { display: spec.display } : {}),
  };

  const catalog = buildCatalog(meta, sources, opts.themeTokens);
  return { catalog, missing, withoutSemantics };
}
