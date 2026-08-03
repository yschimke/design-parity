/**
 * Layout geometry from a Figma node tree.
 *
 * The claude-design adapter captures reference geometry from its own render
 * (`getBoundingClientRect` per element); Figma exposes the same thing statically
 * as `absoluteBoundingBox` on every node. Without this the structural layout
 * diff is a silent no-op for figma-sourced references — `diffLayout` returns
 * early when the reference side has no bounded elements, so a shifted row reads
 * as "no findings" rather than "not checked".
 *
 * The shape mirrors the claude-design extractor's `treeFromRects`: a flat list
 * of labelled, bounded children under a root that carries the capture frame, so
 * the diff engine can recover the density scale between the two sides.
 */
import type { SemanticNode, SemanticTree } from "@design-parity/core";

import type { FigmaNodeDoc } from "./figma-api.js";

/**
 * The label a node matches on. Text nodes use their **visible string**
 * (`characters`), which is what the candidate's semantics carries — that is the
 * match that actually lands. Every other node falls back to its Figma layer
 * `name`, which is a designer-authored handle and generally will *not* match a
 * code semantics label; those elements are kept (they cost nothing — an
 * unmatched reference element is skipped by the diff, not reported) so that
 * reconciling layer names later starts paying off without another change here.
 */
function labelOf(node: FigmaNodeDoc): string | undefined {
  const raw = node.type === "TEXT" ? (node.characters ?? node.name) : node.name;
  const label = raw?.trim();
  return label ? label : undefined;
}

/**
 * Figma's `type` mapped to the diff's notion of a role. Text is left **without**
 * a role deliberately: `diffLayout` keys its text relaxation off `role ===
 * undefined`, gating text on vertical position and height only. A text node's
 * width is content-dependent (Figma measures the tight glyph box, Compose may
 * report a fill-width row), so carrying a role here would manufacture a large
 * bogus `Δwidth` on every string.
 */
function roleOf(node: FigmaNodeDoc): string | undefined {
  return node.type === "TEXT" ? undefined : node.type.toLowerCase();
}

/**
 * Build a {@link SemanticTree} from a Figma structure node, or `undefined` when
 * the node carries no `absoluteBoundingBox` (nothing to compare — the diff then
 * treats the reference as having captured no geometry, which is honest).
 *
 * Bounds are made **root-relative** and rounded to whole dp: Figma's absolute
 * boxes are in canvas space, where a frame sitting at x=12040 would otherwise
 * make every delta meaningless. The root's own box becomes the frame on
 * `root.bounds`, matching what the claude-design side stamps.
 */
export function layoutFromNode(node: FigmaNodeDoc): SemanticTree | undefined {
  const frame = node.absoluteBoundingBox;
  if (!frame) return undefined;

  const children: SemanticNode[] = [];
  const visit = (n: FigmaNodeDoc): void => {
    // The root supplies the frame, not a matchable element.
    if (n !== node) {
      const box = n.absoluteBoundingBox;
      const label = labelOf(n);
      if (box && label) {
        const role = roleOf(n);
        children.push({
          label,
          ...(role ? { role } : {}),
          bounds: {
            x: Math.round(box.x - frame.x),
            y: Math.round(box.y - frame.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
        });
      }
    }
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);

  if (children.length === 0) return undefined;
  return {
    root: {
      children,
      bounds: { x: 0, y: 0, width: Math.round(frame.width), height: Math.round(frame.height) },
    },
  };
}
