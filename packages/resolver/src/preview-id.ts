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
import type { DesignMap } from "@design-parity/core";

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

/** Index a design-map's explicit `previewId` fields → code handle. */
function explicitPreviewMap(designMap: DesignMap | undefined): {
  map: Map<string, string>;
  warnings: string[];
} {
  const map = new Map<string, string>();
  const warnings: string[] = [];
  for (const entry of designMap?.components ?? []) {
    if (!entry.previewId) continue;
    const existing = map.get(entry.previewId);
    if (existing && existing !== entry.code) {
      warnings.push(
        `design-map: previewId '${entry.previewId}' is mapped to both ` +
          `'${existing}' and '${entry.code}'; keeping '${existing}'`,
      );
      continue;
    }
    map.set(entry.previewId, entry.code);
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
    return { code: explicit, linkMethod: "manifest", confidence: "high" };
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
