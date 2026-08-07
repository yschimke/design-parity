/**
 * Linking a placement to the code component that implements it — the "link to
 * the components in the right place" half of the feature.
 *
 * This is the resolver's *reverse* direction (design → code) applied per
 * instance, and it reuses the same committed inputs, in the same precedence
 * order, as the per-component path: Code Connect first, then the repo's
 * `design-map.json`, then a flagged name-convention guess. Nothing here calls a
 * model or a network; the answer is a pure function of what the repo committed.
 *
 * The one page-specific wrinkle is *which ref to look up*. A page holds
 * **instances**, but a link is attached to a **component** — and usually to the
 * component *set* rather than to one variant of it. So each placement is tried
 * against three refs, widest first:
 *
 *   1. the component **set** (`Button`) — where Code Connect normally lives
 *   2. the **main component** (`Button/Primary`) — a per-variant connection
 *   3. the **instance** itself — only a hand-written `design-map.json` entry
 *      would point at one, but if a repo did, honour it
 */
import type { DesignMap } from "@design-parity/core";
import { formatFigmaRef, type CodeConnectMap } from "@design-parity/adapter-figma";
import { buildReverseIndex, codeForRef, type CodeConnectIndex } from "@design-parity/resolver";

import type { InstanceHit } from "./instances.js";
import type { Placement, PlacementLink } from "./types.js";

/** The committed inputs a page link runs against. All optional. */
export interface LinkInputs {
  /** Figma Code Connect links, as the resolver indexes them. */
  codeConnect?: CodeConnectIndex;
  /** The repo's `design-map.json`, already loaded. */
  designMap?: DesignMap;
  /**
   * Known code handles (`"ui/Button.kt#PrimaryButton"`) for last-resort name
   * matching. A match here is always reported as `convention` and should be
   * treated as a hint, not a fact.
   */
  codeHandles?: readonly string[];
}

/** Convert the Figma adapter's Code Connect map into the resolver's index form. */
export function codeConnectIndexOf(map: CodeConnectMap): CodeConnectIndex {
  const index: CodeConnectIndex = {};
  for (const [code, ref] of map) index[code] = formatFigmaRef(ref);
  return index;
}

/** The member name of a code handle (`"ui/Button.kt#Primary"` → `"Primary"`). */
function memberName(handle: string): string {
  const hash = handle.lastIndexOf("#");
  return hash === -1 ? handle : handle.slice(hash + 1);
}

/**
 * The component name an instance's layer name implies.
 *
 * Figma variant instances are named by their path (`"Button/Primary"`) and
 * often carry a state suffix in parentheses; the component a reviewer means is
 * the first segment.
 */
export function baseComponentName(layerName: string): string {
  const head = layerName.split("/")[0] ?? layerName;
  return head.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Normalize a name for convention matching: letters and digits, lowercased. */
function normalizeName(name: string): string {
  return name.replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

/** The result of linking one instance. */
export interface LinkedPlacement {
  placement: Placement;
  /** Non-fatal diagnostics — an ambiguous match, a ref bound to several handles. */
  warnings: string[];
}

/**
 * Link one instance to a code handle.
 *
 * Always returns a {@link Placement}: an instance nothing matched is kept with
 * `link: "unlinked"`, because "this part of the screen has no code behind it"
 * is exactly the finding a page view exists to surface. Dropping it would hide
 * the gap.
 */
export function linkInstance(
  hit: InstanceHit,
  fileKey: string,
  inputs: LinkInputs = {},
): LinkedPlacement {
  const warnings: string[] = [];

  const refs = [hit.componentSetId, hit.componentId, hit.nodeId]
    .filter((id): id is string => !!id)
    .map((nodeId) => formatFigmaRef({ fileKey, nodeId }));

  const codeConnectIndex = buildReverseIndex(undefined, inputs.codeConnect);
  const manifestIndex = buildReverseIndex(inputs.designMap, undefined);

  const pick = (
    index: ReturnType<typeof buildReverseIndex>,
    method: Extract<PlacementLink, "code-connect" | "manifest">,
  ): { code: string; matchedRef: string; link: PlacementLink } | undefined => {
    for (const ref of refs) {
      const codes = codeForRef(index, ref);
      const first = codes[0];
      if (!first) continue;
      if (codes.length > 1) {
        warnings.push(
          `${hit.name} (${hit.nodeId}): ${ref} is bound to ${codes.length} code handles (${codes.join(", ")}); using '${first}'`,
        );
      }
      return { code: first, matchedRef: ref, link: method };
    }
    return undefined;
  };

  const matched = pick(codeConnectIndex, "code-connect") ?? pick(manifestIndex, "manifest");

  const base: Placement = {
    nodeId: hit.nodeId,
    name: hit.name,
    bounds: hit.bounds,
    depth: hit.depth,
    link: "unlinked",
  };
  if (hit.componentId) base.componentId = hit.componentId;
  if (hit.componentSetId) base.componentSetId = hit.componentSetId;

  if (matched) {
    return {
      placement: { ...base, code: matched.code, link: matched.link, matchedRef: matched.matchedRef },
      warnings,
    };
  }

  // Last resort: match the layer's component name against known code handles.
  const wanted = normalizeName(baseComponentName(hit.name));
  if (wanted) {
    const candidates = (inputs.codeHandles ?? []).filter(
      (handle) => normalizeName(memberName(handle)) === wanted,
    );
    const only = candidates[0];
    if (candidates.length === 1 && only) {
      return { placement: { ...base, code: only, link: "convention" }, warnings };
    }
    if (candidates.length > 1) {
      warnings.push(
        `${hit.name} (${hit.nodeId}): name '${baseComponentName(hit.name)}' matches ${candidates.length} code handles (${[...candidates].sort().join(", ")}); left unlinked`,
      );
    }
  }

  return { placement: base, warnings };
}

/** Link every instance on a page, aggregating diagnostics. */
export function linkInstances(
  hits: readonly InstanceHit[],
  fileKey: string,
  inputs: LinkInputs = {},
): { placements: Placement[]; warnings: string[] } {
  const placements: Placement[] = [];
  const warnings: string[] = [];
  for (const hit of hits) {
    const linked = linkInstance(hit, fileKey, inputs);
    placements.push(linked.placement);
    warnings.push(...linked.warnings);
  }
  return { placements, warnings };
}
