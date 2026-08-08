/**
 * Build the **slot redline** layer for a component — the spacing spec.
 *
 * Where the greenlines annotate accessibility, the redlines annotate **layout**:
 * for each node that carries layout geometry, a {@link Redline} records its
 * bounding box plus the padding it insets its content by, the gap it spaces its
 * children by (`Arrangement.spacedBy`), and its corner radius. So a component and
 * its slots each get a box, and the padding *between* slots is captured as a
 * number — the redline a designer reads off a spec.
 *
 * The data is already on the {@link SemanticTree} the renderer produced
 * (`@design-parity/candidate` maps `compose/semantics`' per-node `padding` / `gap`
 * / `cornerRadius` into `tokens.spacing` / `tokens.radius`); this module just
 * surfaces it as a flat, importable layer. Pure functions over core types.
 *
 * Coverage note: this walks the **semantics** tree, so a slot that carries no
 * semantics (a decorative icon, a spacer) produces no node and so no redline.
 * Full slot coverage needs the layout/placeable tree — a renderer-side follow-up.
 */
import type { SemanticNode, SemanticTree } from "@design-parity/core";

import type { Redline, RedlinePadding } from "./types.js";

/** Read per-edge padding out of a node's resolved `spacing` token bag. */
function readPadding(spacing: Record<string, number> | undefined): RedlinePadding | undefined {
  if (!spacing) return undefined;
  // Uniform padding is also emitted as `padding`; expand it to all four edges
  // unless a specific edge overrides it.
  const uniform = spacing["padding"];
  const out: RedlinePadding = {};
  const edge = (key: string): number | undefined =>
    spacing[key] !== undefined ? spacing[key] : uniform;
  const start = edge("paddingStart");
  const top = edge("paddingTop");
  const end = edge("paddingEnd");
  const bottom = edge("paddingBottom");
  if (start !== undefined) out.start = start;
  if (top !== undefined) out.top = top;
  if (end !== undefined) out.end = end;
  if (bottom !== undefined) out.bottom = bottom;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A node carries a redline when it has a box and any spacing/shape spec. */
function nodeRedline(node: SemanticNode): Redline | undefined {
  if (!node.bounds) return undefined;
  const padding = readPadding(node.tokens?.spacing);
  const gap = node.tokens?.spacing?.["gap"];
  const cornerRadius = node.tokens?.radius?.["corner"];
  if (!padding && gap === undefined && cornerRadius === undefined) return undefined;

  const out: Redline = { bounds: node.bounds };
  if (node.role !== undefined) out.role = node.role;
  if (node.label !== undefined) out.label = node.label;
  if (node.testTag !== undefined) out.testTag = node.testTag;
  if (padding) out.padding = padding;
  if (gap !== undefined) out.gap = gap;
  if (cornerRadius !== undefined) out.cornerRadius = cornerRadius;
  // Only meaningful once there is spacing to qualify — a radius-only redline is
  // always declared, and tagging it "derived" would misdescribe it.
  if (node.spacingSource === "derived" && (padding || gap !== undefined)) {
    out.spacingSource = "derived";
  }
  return out;
}

/**
 * Walk a {@link SemanticTree} and emit a {@link Redline} for every node that
 * carries layout geometry (a box plus padding / gap / corner radius), in
 * depth-first order — the component box first, then its slots.
 */
export function buildRedlines(semantics: SemanticTree | undefined): Redline[] {
  if (!semantics) return [];
  const out: Redline[] = [];
  const visit = (node: SemanticNode): void => {
    const redline = nodeRedline(node);
    if (redline) out.push(redline);
    for (const child of node.children ?? []) visit(child);
  };
  visit(semantics.root);
  return out;
}
