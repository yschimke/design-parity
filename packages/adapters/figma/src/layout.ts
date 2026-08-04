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
import type {
  DesignTokens,
  SemanticNode,
  SemanticTree,
  TypographyToken,
} from "@design-parity/core";

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
/**
 * Read a node's spacing / shape / type spec into resolved tokens.
 *
 * Geometry alone says where an element is; these say what it is *specified* as —
 * the padding, gap, radius and type style a designer reads off the frame. They
 * are keyed to match what `@design-parity/catalog-export`'s redline walk expects
 * (`spacing.padding*`, `spacing.gap`, `radius.corner`), so the reference side of a
 * comparison is described in the same vocabulary as the candidate side.
 *
 * Figma's `paddingLeft`/`paddingRight` are physical edges; they are mapped to
 * `start`/`end` on the LTR reading that the rest of this adapter already assumes.
 *
 * The type style is keyed `text` rather than invented as a design-system token
 * name: the node alone cannot say whether it is `labelLarge`, and a fabricated
 * token name would read as a spec claim the file never made.
 */
function tokensOf(node: FigmaNodeDoc): DesignTokens | undefined {
  const spacing: Record<string, number> = {};
  if (node.paddingTop !== undefined) spacing.paddingTop = node.paddingTop;
  if (node.paddingBottom !== undefined) spacing.paddingBottom = node.paddingBottom;
  if (node.paddingLeft !== undefined) spacing.paddingStart = node.paddingLeft;
  if (node.paddingRight !== undefined) spacing.paddingEnd = node.paddingRight;
  if (node.itemSpacing !== undefined) spacing.gap = node.itemSpacing;

  const tokens: DesignTokens = {};
  if (Object.keys(spacing).length > 0) tokens.spacing = spacing;
  if (node.cornerRadius !== undefined) tokens.radius = { corner: node.cornerRadius };

  const style = node.style;
  if (style && (style.fontSize !== undefined || style.lineHeightPx !== undefined)) {
    const text: TypographyToken = {};
    if (style.fontFamily !== undefined) text.fontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) text.fontWeight = style.fontWeight;
    if (style.fontSize !== undefined) text.fontSize = style.fontSize;
    if (style.lineHeightPx !== undefined) text.lineHeight = style.lineHeightPx;
    if (style.letterSpacing !== undefined) text.letterSpacing = style.letterSpacing;
    tokens.typography = { text };
  }

  return Object.keys(tokens).length > 0 ? tokens : undefined;
}

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
        const tokens = tokensOf(n);
        children.push({
          label,
          ...(role ? { role } : {}),
          ...(tokens ? { tokens } : {}),
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
  const rootTokens = tokensOf(node);
  return {
    root: {
      children,
      ...(rootTokens ? { tokens: rootTokens } : {}),
      bounds: { x: 0, y: 0, width: Math.round(frame.width), height: Math.round(frame.height) },
    },
  };
}
