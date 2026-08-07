/**
 * Finding the component instances on a page, and converting their geometry into
 * the manifest's frame-local space.
 *
 * Pure tree walking over a fetched {@link PageNode} — no network, no linking.
 * The linking step ({@link file://./link.ts}) consumes what this produces.
 */
import type { ComponentMeta, PageDocument, PageNode } from "./fetcher.js";
import type { PageRect } from "./types.js";

/** A component instance found on a page, before it is linked to any code. */
export interface InstanceHit {
  nodeId: string;
  name: string;
  componentId?: string;
  componentSetId?: string;
  bounds: PageRect;
  depth: number;
}

/** Round to 2dp — enough for sub-pixel layout, short and stable in JSON. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whether a node is visible. Figma omits the field for visible layers. */
function isVisible(node: PageNode): boolean {
  return node.visible !== false;
}

/**
 * The set id of an instance's main component, when it is one variant of a set.
 *
 * Figma reports this on the file-level `components` map rather than on the
 * instance, and it matters because Code Connect is usually attached to the
 * *set* (`Button`), not to each variant (`Button/Primary`, `Button/Ghost`).
 */
function setIdOf(
  componentId: string | undefined,
  components: Record<string, ComponentMeta> | undefined,
): string | undefined {
  if (!componentId) return undefined;
  const meta = components?.[componentId];
  const setId = meta?.componentSetId;
  return setId && setId !== "" ? setId : undefined;
}

/**
 * Collect the component instances on a page frame.
 *
 * - Hidden layers (and their subtrees) are skipped — they aren't on the screen
 *   a reviewer is looking at.
 * - Instances with no geometry, zero area, or a box entirely outside the frame
 *   are skipped: they can't be placed on the backdrop.
 * - By default the walk **does not descend into an instance**. The outermost
 *   instance is the placement that means something ("this is our `OfferCard`");
 *   descending would bury it under every button and icon it contains. Pass
 *   `nested` to record those too, tagged with their {@link InstanceHit.depth}.
 *
 * Results are ordered top-left first (`y`, then `x`, then node id) so a
 * re-import produces a byte-identical manifest.
 */
export function collectInstances(
  page: PageDocument,
  opts: { nested?: boolean } = {},
): InstanceHit[] {
  const root = page.document;
  const frame = root.absoluteBoundingBox;
  if (!frame) {
    throw new Error(
      `page-backdrop: page node '${root.id}' (${root.name}) has no bounding box; only a frame can be a backdrop`,
    );
  }

  const hits: InstanceHit[] = [];

  const visit = (node: PageNode, depth: number): void => {
    if (!isVisible(node)) return;

    const isInstance = node.type === "INSTANCE";
    if (isInstance) {
      const box = node.absoluteBoundingBox;
      const placeable =
        !!box &&
        box.width > 0 &&
        box.height > 0 &&
        // Overlaps the frame at all; a fully off-frame instance has nowhere to sit.
        box.x < frame.x + frame.width &&
        box.y < frame.y + frame.height &&
        box.x + box.width > frame.x &&
        box.y + box.height > frame.y;

      if (placeable && box) {
        const componentId = node.componentId;
        const componentSetId = setIdOf(componentId, page.components);
        const hit: InstanceHit = {
          nodeId: node.id,
          name: node.name,
          bounds: {
            x: r(box.x - frame.x),
            y: r(box.y - frame.y),
            width: r(box.width),
            height: r(box.height),
          },
          depth,
        };
        if (componentId) hit.componentId = componentId;
        if (componentSetId) hit.componentSetId = componentSetId;
        hits.push(hit);
      }

      // An unplaceable instance is still a boundary: only `nested` descends.
      if (!opts.nested) return;
      for (const child of node.children ?? []) visit(child, depth + 1);
      return;
    }

    for (const child of node.children ?? []) visit(child, depth);
  };

  for (const child of root.children ?? []) visit(child, 0);

  hits.sort(
    (a, b) =>
      a.bounds.y - b.bounds.y ||
      a.bounds.x - b.bounds.x ||
      a.nodeId.localeCompare(b.nodeId),
  );
  return hits;
}

/** The frame's own size, in design units. */
export function frameSize(page: PageDocument): { width: number; height: number } {
  const frame = page.document.absoluteBoundingBox;
  if (!frame) {
    throw new Error(
      `page-backdrop: page node '${page.document.id}' has no bounding box`,
    );
  }
  return { width: r(frame.width), height: r(frame.height) };
}
