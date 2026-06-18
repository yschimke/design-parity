/**
 * Reconcile compose-ai-tools **preview ids** with design-parity **code handles**
 * (issue #44).
 *
 * compose-ai-tools identifies a rendered component by a `previewId`
 * (`"<fqClass>.<function>"`, e.g. `"ee.app.FooKt.Bar"`), while design references
 * and `design-map.json` use a code handle `path#Member`
 * (`"ui/Button.kt#PrimaryButton"`). The orchestrator pairs a candidate to its
 * reference **by `componentId`**, so a preview-bundle / daemon candidate (keyed
 * by `previewId`) would never match its reference (keyed by code handle) — the
 * ids live in different namespaces.
 *
 * This module is the bridge, mirroring the resolver's precedence: an **explicit**
 * `previewId` field on a `design-map.json` entry wins (high confidence); failing
 * that, a **convention** derives the handle from the preview's own source file +
 * function (`sourceFile#functionName`, low confidence). Pure and deterministic —
 * depends only on `@design-parity/core`.
 */
import type { DesignMap, PreviewIdVariant, Theme } from "@design-parity/core";
import { entryPreviewIds } from "@design-parity/core";

/** The variant slot a tagged `previewId` fills (state/theme/size, no handle). */
export type PreviewVariantSlot = Omit<PreviewIdVariant, "previewId">;

/**
 * The identifying bits of a compose-ai-tools preview, as a bundle's
 * `previews.json` (or a daemon's preview index) surfaces them. Only `id` is
 * required; `sourceFile` + `functionName` enable the convention fallback.
 */
export interface PreviewIdentity {
  /** The raw preview id (`previews.json` `id`), e.g. `"ee.app.FooKt.Bar"`. */
  id: string;
  /** Repo-relative source file, e.g. `"ui/Foo.kt"`. */
  sourceFile?: string;
  /** Top-level `@Preview` function name, e.g. `"Bar"`. */
  functionName?: string;
}

/** A preview id resolved to a code handle, with provenance. */
export interface PreviewCodeMatch {
  /** The code handle, e.g. `"ui/Foo.kt#Bar"`. */
  code: string;
  /** `manifest` for an explicit `design-map` link, `convention` for the fallback. */
  linkMethod: "manifest" | "convention";
  /** `manifest` links are `"high"`; convention links are always `"low"`. */
  confidence: "high" | "low";
  /**
   * The variant slot (state/theme/size) this preview fills, when the explicit
   * `design-map` link tagged it (a `previewId` variant list, issue #111). The
   * candidate side re-tags the resolved preview's image(s) onto this slot so a
   * per-theme `@Preview` keys against its matching reference variant. Absent for
   * single-string links and convention matches.
   */
  variant?: PreviewVariantSlot;
}

/** Outcome of reconciling a batch of preview ids. */
export interface PreviewResolveResult {
  /** Preview id → resolved code handle (only the ones that matched). */
  matches: Map<string, PreviewCodeMatch>;
  /** Preview ids that mapped to no code handle. */
  unmatched: string[];
  /** Non-fatal diagnostics: ambiguous explicit links, unmatched ids. */
  warnings: string[];
}

/** The non-empty variant tags on a tagged previewId, or `undefined` if none. */
function variantSlot(v: PreviewIdVariant): PreviewVariantSlot | undefined {
  const slot: PreviewVariantSlot = {};
  if (v.state !== undefined) slot.state = v.state;
  if (v.theme !== undefined) slot.theme = v.theme as Theme;
  if (v.size !== undefined) slot.size = v.size;
  return Object.keys(slot).length > 0 ? slot : undefined;
}

/** One explicit `design-map` preview link: the code handle and its variant slot. */
interface ExplicitLink {
  code: string;
  variant?: PreviewVariantSlot;
}

/**
 * Index a design-map's explicit `previewId` fields → code handle. A string
 * `previewId` binds one untagged preview; a variant list binds several tagged
 * previews to the same code handle, each carrying its slot (issue #111).
 */
function explicitPreviewMap(designMap: DesignMap | undefined): {
  map: Map<string, ExplicitLink>;
  warnings: string[];
} {
  const map = new Map<string, ExplicitLink>();
  const warnings: string[] = [];
  for (const entry of designMap?.components ?? []) {
    for (const variant of entryPreviewIds(entry)) {
      const existing = map.get(variant.previewId);
      if (existing && existing.code !== entry.code) {
        warnings.push(
          `design-map: previewId '${variant.previewId}' is mapped to both ` +
            `'${existing.code}' and '${entry.code}'; keeping '${existing.code}'`,
        );
        continue;
      }
      const slot = variantSlot(variant);
      map.set(variant.previewId, slot ? { code: entry.code, variant: slot } : { code: entry.code });
    }
  }
  return { map, warnings };
}

/** A code handle must be `path#Member`; mirror the design-map schema's pattern. */
function isCodeHandle(value: string): boolean {
  const hash = value.indexOf("#");
  return hash > 0 && hash < value.length - 1;
}

/**
 * Resolve one preview to its code handle: an explicit `design-map` `previewId`
 * link first (high), else the `sourceFile#functionName` convention (low).
 * Returns `undefined` when neither applies.
 */
export function codeHandleForPreview(
  preview: PreviewIdentity,
  designMap?: DesignMap,
): PreviewCodeMatch | undefined {
  const explicit = explicitPreviewMap(designMap).map.get(preview.id);
  if (explicit !== undefined) {
    return {
      code: explicit.code,
      linkMethod: "manifest",
      confidence: "high",
      ...(explicit.variant ? { variant: explicit.variant } : {}),
    };
  }
  if (preview.sourceFile && preview.functionName) {
    const code = `${preview.sourceFile}#${preview.functionName}`;
    if (isCodeHandle(code)) {
      return { code, linkMethod: "convention", confidence: "low" };
    }
  }
  return undefined;
}

/**
 * Reconcile a batch of preview ids to code handles. Matched ids land in
 * {@link PreviewResolveResult.matches}; ids that resolve to nothing land in
 * `unmatched` with a warning, rather than silently failing to pair (issue #44
 * acceptance).
 */
export function resolvePreviewIds(
  previews: Iterable<PreviewIdentity>,
  designMap?: DesignMap,
): PreviewResolveResult {
  const matches = new Map<string, PreviewCodeMatch>();
  const unmatched: string[] = [];
  const { warnings } = explicitPreviewMap(designMap);

  for (const preview of previews) {
    const match = codeHandleForPreview(preview, designMap);
    if (match) {
      matches.set(preview.id, match);
    } else {
      unmatched.push(preview.id);
      warnings.push(
        `preview '${preview.id}' has no code handle: add a design-map entry ` +
          `with a matching 'previewId', or ensure the bundle carries its ` +
          `sourceFile + functionName for convention matching`,
      );
    }
  }

  return { matches, unmatched, warnings };
}
