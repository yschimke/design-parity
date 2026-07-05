/**
 * Correspondence authoring — emit a `design-map.json` from an import.
 *
 * The plugin *creates* the catalog's frames, so it uniquely knows each imported
 * component's Figma node id. That closes design-parity's correspondence loop:
 * once a code component's render lives at a known Figma node, the resolver can
 * map code ↔ design without Code Connect (its `Code Connect → design-map.json →
 * name convention` fallback chain).
 *
 * The plugin emits the *authoritative* half of each entry — `source: "figma"`
 * and `ref: figma:<fileKey>/<nodeId>` pointing at the frame it just placed — but
 * a catalog carries only a `componentId` ("Button/Filled"), not the `file#symbol`
 * code handle the design-map's `code` field requires. So the result is a
 * **scaffold**: `code` is derived from the componentId ({@link componentIdToCode})
 * and meant to be reconciled with the consumer's real component handle. The
 * tedious half (a node id per component) is automated; the author fixes `code`.
 *
 * Pure: no `figma`, no I/O. The main thread supplies the file key + the
 * `componentId → nodeId` map it collected while building the scene.
 */
import type { DesignMap, DesignMapEntry } from "@design-parity/core";

import type { ImportPlan } from "./plan.js";

/**
 * The canonical design-map figma ref: `figma:<fileKey>/<nodeId>`, node id in
 * colon form (`1:42`). Mirrors `@design-parity/adapter-figma`'s `formatFigmaRef`
 * — inlined rather than imported so this stays out of the browser bundle (the
 * adapter barrel pulls in its REST client). Kept in sync with that parser's
 * `figma:([A-Za-z0-9]+)/([0-9]+[:-][0-9]+)` grammar.
 */
export function figmaRef(fileKey: string, nodeId: string): string {
  return `figma:${fileKey}/${nodeId}`;
}

/**
 * Derive a starter `file#symbol` code handle from a catalog `componentId`, which
 * the design-map schema requires (`^.+#.+$`) but a catalog doesn't carry. Splits
 * the last `/` segment as the symbol (`"Button/Filled"` → `"Button#Filled"`);
 * an id with no `/` repeats itself (`"Switch"` → `"Switch#Switch"`). This is a
 * scaffold — the author reconciles it with their real component handle.
 */
export function componentIdToCode(componentId: string): string {
  const slash = componentId.lastIndexOf("/");
  if (slash > 0 && slash < componentId.length - 1) {
    return `${componentId.slice(0, slash)}#${componentId.slice(slash + 1)}`;
  }
  return `${componentId}#${componentId}`;
}

export interface DesignMapOptions {
  /** The Figma file key the frames were imported into (`figma.fileKey`). */
  fileKey: string;
  /** `componentId → created node id`, collected by the main thread. */
  nodeIds: Record<string, string>;
}

/**
 * Build the `design-map.json` for an import (pure). One entry per component that
 * was actually placed (has a node id); components without a node id — e.g. ones
 * whose images failed to fetch — are skipped rather than emitted danglingly.
 * Entry order follows the plan's group/component order for a deterministic file.
 */
export function buildDesignMap(
  plan: ImportPlan,
  opts: DesignMapOptions,
): DesignMap {
  const components: DesignMapEntry[] = [];
  for (const group of plan.groups) {
    for (const component of group.components) {
      const nodeId = opts.nodeIds[component.componentId];
      if (nodeId === undefined) continue;
      components.push({
        code: componentIdToCode(component.componentId),
        source: "figma",
        ref: figmaRef(opts.fileKey, nodeId),
      });
    }
  }
  return { components };
}
