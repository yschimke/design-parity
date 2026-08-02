/** Pure planning for design-map-driven upgrades of legacy Figma imports. */
import type { CatalogManifest } from "@design-parity/catalog-export";
import type { DesignMap, DesignMapEntry, RefVariant } from "@design-parity/core";

import { componentSetCells, type ComponentSetCell } from "./catalogPick.js";
import { componentIdToCode } from "./designMap.js";

export interface UpgradeJob {
  componentId: string;
  nodeId: string;
  cells: ComponentSetCell[];
}

export interface UpgradeSkip {
  code: string;
  reason: string;
}

export interface UpgradePlan {
  jobs: UpgradeJob[];
  skipped: UpgradeSkip[];
}

function nodeIdFromRef(ref: string, fileKey: string): string | undefined {
  const match = /^figma:([^/]+)\/([0-9]+[:-][0-9]+)$/.exec(ref);
  return match?.[1] === fileKey ? match[2] : undefined;
}

function componentFor(entry: DesignMapEntry, manifest: CatalogManifest): string | undefined {
  if (typeof entry.previewId === "string") {
    const exact = manifest.components.find((component) => component.componentId === entry.previewId);
    if (exact) return exact.componentId;
  }
  return manifest.components.find((component) => componentIdToCode(component.componentId) === entry.code)?.componentId;
}

/** Resolve scalar same-file Figma refs to catalog components without name guessing. */
export function planMappedUpgrades(
  manifest: CatalogManifest,
  map: DesignMap,
  fileKey: string,
  baseUrl: string,
): UpgradePlan {
  const jobs: UpgradeJob[] = [];
  const skipped: UpgradeSkip[] = [];
  const seen = new Set<string>();
  for (const entry of map.components) {
    if (entry.source !== "figma") {
      skipped.push({ code: entry.code, reason: "not a Figma mapping" });
      continue;
    }
    if (typeof entry.ref !== "string") {
      skipped.push({ code: entry.code, reason: "variant-tagged refs need an explicit one-node-per-variant upgrade" });
      continue;
    }
    const nodeId = nodeIdFromRef(entry.ref, fileKey);
    if (!nodeId) {
      skipped.push({ code: entry.code, reason: "mapping points to a different Figma file" });
      continue;
    }
    const componentId = componentFor(entry, manifest);
    if (!componentId) {
      skipped.push({ code: entry.code, reason: "no matching catalog component or previewId" });
      continue;
    }
    const cells = componentSetCells(manifest, componentId, baseUrl);
    if (!cells.length) {
      skipped.push({ code: entry.code, reason: "catalog component has no ideal renders" });
      continue;
    }
    if (seen.has(nodeId)) {
      skipped.push({ code: entry.code, reason: "node is already targeted by another mapping" });
      continue;
    }
    seen.add(nodeId);
    jobs.push({ componentId, nodeId, cells });
  }
  return { jobs, skipped };
}

function replaceRef(ref: string, fileKey: string, replacements: Record<string, string>): string {
  const nodeId = nodeIdFromRef(ref, fileKey);
  return nodeId && replacements[nodeId]
    ? `figma:${fileKey}/${replacements[nodeId]}`
    : ref;
}

/** Rewrite only upgraded node ids, preserving every other mapping field/variant tag. */
export function rewriteMappedNodeIds(
  map: DesignMap,
  fileKey: string,
  replacements: Record<string, string>,
): DesignMap {
  return {
    ...map,
    components: map.components.map((entry) => ({
      ...entry,
      ref: typeof entry.ref === "string"
        ? replaceRef(entry.ref, fileKey, replacements)
        : entry.ref.map((variant): RefVariant => ({
            ...variant,
            ref: replaceRef(variant.ref, fileKey, replacements),
          })),
    })),
  };
}
