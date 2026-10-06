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

import { catalogFromCandidates as joinCatalogFromCandidates } from "./join/catalog-join.js";
import type { ComponentSource } from "./ingest.js";
import type { CatalogImage } from "./types.js";
import type {
  Catalog,
  CatalogDisplay,
  CatalogScreen,
  CatalogTheme,
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
  /** Stated reason there is no {@link reference}; see {@link CatalogComponent.noReference}. */
  noReference?: string;
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

/**
 * Project candidate images into the published catalog image model.
 *
 * Per-image semantics are candidate-only comparison input. Catalog annotations
 * are derived from the render-wide semantics tree, so do not leak the sidecar
 * onto an image that the catalog manifest cannot serialize.
 */
function catalogImages(candidate: CandidateRender): CatalogImage[] {
  const previewId = candidate.previewId ?? candidate.componentId;
  return candidate.images.map((source) => {
    const { semantics: _candidateSemantics, ...image } = source;
    return {
      ...image,
      previewId: (source as CatalogImage).previewId ?? previewId,
    };
  });
}

export interface FromCandidatesOptions {
  /** `compose-preview` version, recorded as provenance. */
  renderer?: string;
  /** Generation timestamp; defaults to now (ISO-8601). */
  generatedAt?: string;
  /** Explicit system token set; otherwise lifted from a component's semantics. */
  themeTokens?: DesignTokens;
  /**
   * The system's alternate named themes, each with its own resolved token set —
   * see {@link CatalogTheme}. Never lifted from the renders (a component's
   * semantics carry the one theme it was rendered under), so a generator that
   * knows which render belongs to which declared theme supplies them here.
   */
  themes?: readonly CatalogTheme[];
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
  // The join matches on `functionName ?? componentId`, because the export driver's resolver sets
  // `componentId` to the function name. A caller without that resolver names the function by the
  // preview id's last segment, so derive it here when the candidate does not carry one.
  const prepared = candidates.map((candidate) => ({
    ...candidate,
    functionName: candidate.functionName ?? functionOf(candidate),
    images: catalogImages(candidate),
  }));
  return joinCatalogFromCandidates(prepared, spec, opts) as FromCandidatesResult;
}
