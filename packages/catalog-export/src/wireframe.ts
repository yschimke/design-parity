/**
 * Build the **wireframe SVG** for a component — the schematic that borders every
 * composable, generated *ahead of time* from the semantics tree the renderer
 * already produced.
 *
 * `compose/semantics-wireframe` produces this SVG in the daemon, but the static
 * bundle ships the compact per-node geometry (bounds) rather than the SVG, so a
 * static catalog has no wireframe render. Since the same bounds ride along on
 * the {@link SemanticTree} (they already drive the redlines), we regenerate the
 * wireframe here — a pure `bounds → SVG` projection, baked into the published
 * bundle so the importer only has to *place* it, never compute it.
 *
 * The output is a plain, deterministic vector: one bordered rectangle per node
 * that carries a box, in the render's own pixel space, so it overlays/compares
 * against the ideal render 1:1. No fills, no text — the schematic a designer
 * reads as "where every box sits".
 */
import type { Bounds, SemanticNode, SemanticTree } from "@design-parity/core";

/** Muted ink for the wireframe strokes — legible on light and dark. */
const STROKE = "#5B6470";

/** Collect every node that carries a box, depth-first (root included). */
function boxedNodes(root: SemanticNode): SemanticNode[] {
  const out: SemanticNode[] = [];
  const walk = (n: SemanticNode): void => {
    if (n.bounds) out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** The union box of a set of bounds — the SVG viewport. */
function union(boxes: Bounds[]): Bounds {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Round to 2dp without trailing zeros, for compact deterministic output. */
function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Project a component's {@link SemanticTree} into a wireframe SVG string, or
 * `undefined` when no node carries a box (nothing to draw). Pure and
 * deterministic — the same tree always yields byte-identical SVG.
 */
export function buildWireframeSvg(tree: SemanticTree | undefined): string | undefined {
  if (!tree) return undefined;
  const nodes = boxedNodes(tree.root);
  if (nodes.length === 0) return undefined;

  const box = union(nodes.map((node) => node.bounds!));
  const rects = nodes
    .map((node) => {
      const b = node.bounds!;
      return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(Math.max(0, b.width))}" height="${n(Math.max(0, b.height))}" fill="none" stroke="${STROKE}" stroke-width="1"/>`;
    })
    .join("");
  const w = n(box.width);
  const h = n(box.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"` +
    ` viewBox="${n(box.x)} ${n(box.y)} ${w} ${h}">${rects}</svg>`
  );
}
