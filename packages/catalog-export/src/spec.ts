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
import type { Catalog, ComponentReference } from "./types.js";

/** One component slot in a {@link CatalogSpec} group. */
export interface CatalogSpecComponent {
  /** Stable component id, e.g. `"Button/Filled"`. */
  componentId: string;
  /** The `@Preview` **function name** that renders it, e.g. `"FilledButton"`. */
  preview: string;
  caption?: string;
  /** Published-kit reference (URL or `figma:` handle) for the seed import. */
  reference?: ComponentReference;
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
}

/** The function-name tail of a preview id (`"a.b.CKt.FilledButton"` → `"FilledButton"`). */
function functionOf(candidate: CandidateRender): string {
  const id = candidate.previewId ?? candidate.componentId;
  const tail = id.split(".").pop() ?? id;
  // Strip a trailing capture/variant suffix if the producer appended one.
  return tail;
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
  const byFunction = new Map<string, CandidateRender>();
  for (const candidate of candidates) {
    byFunction.set(functionOf(candidate), candidate);
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
      const source: ComponentSource = {
        componentId: component.componentId,
        group: group.name,
        ideal: [...candidate.images],
      };
      if (component.caption !== undefined) source.caption = component.caption;
      if (component.reference !== undefined) source.reference = component.reference;
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
  };

  const catalog = buildCatalog(meta, sources, opts.themeTokens);
  return { catalog, missing, withoutSemantics };
}
