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

import type { FigmaNodeDoc, FigmaStyleMeta } from "./figma-api.js";
import { solidFill } from "./paint.js";
import { tokenPath } from "./token-name.js";

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
 * The union of a node's bounded children, in canvas space — the box the content
 * actually occupies. `undefined` when no child carries a box.
 */
function contentBox(
  node: FigmaNodeDoc,
): { left: number; top: number; right: number; bottom: number } | undefined {
  const boxes = (node.children ?? [])
    .map((c) => c.absoluteBoundingBox)
    .filter((b): b is NonNullable<FigmaNodeDoc["absoluteBoundingBox"]> => b !== undefined);
  if (boxes.length === 0) return undefined;
  return {
    left: Math.min(...boxes.map((b) => b.x)),
    top: Math.min(...boxes.map((b) => b.y)),
    right: Math.max(...boxes.map((b) => b.x + b.width)),
    bottom: Math.max(...boxes.map((b) => b.y + b.height)),
  };
}

/**
 * The one spacing a node's children are evenly separated by, along whichever
 * axis they stack on. `undefined` unless there are at least two children, they
 * are laid out in a single non-overlapping run on exactly one axis, and every
 * gap in that run agrees to within half a source pixel.
 *
 * The strictness is deliberate. A grid, an overlapping stack, or a run whose
 * gaps differ has no single "the gap" — reporting the mean of 8, 8 and 24 would
 * state a rhythm the artwork does not have, which is worse than saying nothing.
 */
function measuredGap(node: FigmaNodeDoc): number | undefined {
  const boxes = (node.children ?? [])
    .map((c) => c.absoluteBoundingBox)
    .filter((b): b is NonNullable<FigmaNodeDoc["absoluteBoundingBox"]> => b !== undefined);
  if (boxes.length < 2) return undefined;

  const runGap = (
    start: (b: (typeof boxes)[number]) => number,
    end: (b: (typeof boxes)[number]) => number,
  ): number | undefined => {
    const sorted = [...boxes].sort((a, b) => start(a) - start(b));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = start(sorted[i]!) - end(sorted[i - 1]!);
      // A negative gap is an overlap, so this axis is not the stacking axis.
      if (gap < 0) return undefined;
      gaps.push(gap);
    }
    const first = gaps[0]!;
    return gaps.every((g) => Math.abs(g - first) <= 0.5) ? first : undefined;
  };

  const vertical = runGap(
    (b) => b.y,
    (b) => b.y + b.height,
  );
  const horizontal = runGap(
    (b) => b.x,
    (b) => b.x + b.width,
  );
  // Both axes non-overlapping means the children are on a diagonal or a grid —
  // no single stacking axis, so no gap to report.
  if (vertical !== undefined && horizontal !== undefined) return undefined;
  return vertical ?? horizontal;
}

/**
 * Spacing **measured** from a node's child geometry, for a frame that declares
 * none — which is most of them, since only an auto-layout frame carries Figma's
 * `padding*` / `itemSpacing` fields and a hand-placed mock carries nothing.
 *
 * Without this the reference column of a compare page has no layout layer at
 * all: the type sizes line up beside the render's, and the spacing — the more
 * common design-review question — shows on the code side only.
 *
 * What it reports is an observation, not a spec, and the caller stamps
 * {@link SemanticNode.spacingSource} `"derived"` so every consumer can say so.
 * Two things are dropped rather than reported as zero, because a derived zero
 * carries no information a reader can act on: an all-zero inset (a child that
 * fills its parent, the usual wrapper frame) and a zero gap (children that abut
 * or overlap). A negative inset means a child overflows its parent on that
 * edge — not padding, so that edge is dropped too.
 */
function measuredSpacing(node: FigmaNodeDoc): Record<string, number> | undefined {
  const box = node.absoluteBoundingBox;
  const content = box ? contentBox(node) : undefined;
  const out: Record<string, number> = {};

  if (box && content) {
    const insets: Record<string, number> = {
      paddingStart: content.left - box.x,
      paddingTop: content.top - box.y,
      paddingEnd: box.x + box.width - content.right,
      paddingBottom: box.y + box.height - content.bottom,
    };
    const kept = Object.entries(insets).filter(([, v]) => v >= 0);
    if (kept.some(([, v]) => Math.round(v) > 0)) {
      for (const [edge, value] of kept) out[edge] = Math.round(value);
    }
  }

  const gap = measuredGap(node);
  if (gap !== undefined && Math.round(gap) > 0) out.gap = Math.round(gap);

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read a node's spacing / shape / type spec into resolved tokens, plus where the
 * spacing came from (see {@link SemanticNode.spacingSource}).
 *
 * Geometry alone says where an element is; these say what it is *specified* as —
 * the padding, gap, radius and type style a designer reads off the frame. They
 * are keyed to match what `@design-parity/catalog-export`'s redline walk expects
 * (`spacing.padding*`, `spacing.gap`, `radius.corner`), so the reference side of a
 * comparison is described in the same vocabulary as the candidate side.
 *
 * Figma's `paddingLeft`/`paddingRight` are physical edges; they are mapped to
 * `start`/`end` on the LTR reading that the rest of this adapter already assumes.
 * A frame that declares any of them is taken at its word; one that declares none
 * falls back to {@link measuredSpacing}, which measures the same vocabulary off
 * the children. Declared always wins — a partial auto-layout spec is still the
 * designer's, and mixing a declared padding with a measured gap would produce
 * one annotation whose halves mean different things.
 *
 * The type style is keyed `text` unless the node wears a **published text
 * style**, in which case it is keyed by that style's own name (`Body/Large` →
 * `body/large`). The distinction is the same one the rest of this adapter keeps:
 * a node's local type properties cannot say whether they are `labelLarge`, and
 * inventing a name would read as a spec claim the file never made — but a
 * published style *is* the file saying what it calls that type, so quoting it is
 * reporting, not inference. Resolving it needs the file-level `styles` map
 * (style id → name), which only the caller has; without one every node falls
 * back to `text` exactly as before.
 */
function tokensOf(
  node: FigmaNodeDoc,
  styles: StyleMap | undefined,
  inheritedBackground?: string,
): { tokens: DesignTokens; spacingSource?: SemanticNode["spacingSource"] } | undefined {
  const declared: Record<string, number> = {};
  if (node.paddingTop !== undefined) declared.paddingTop = node.paddingTop;
  if (node.paddingBottom !== undefined) declared.paddingBottom = node.paddingBottom;
  if (node.paddingLeft !== undefined) declared.paddingStart = node.paddingLeft;
  if (node.paddingRight !== undefined) declared.paddingEnd = node.paddingRight;
  if (node.itemSpacing !== undefined) declared.gap = node.itemSpacing;

  const tokens: DesignTokens = {};
  const spacing =
    Object.keys(declared).length > 0 ? declared : (measuredSpacing(node) ?? declared);
  const spacingSource: SemanticNode["spacingSource"] | undefined =
    Object.keys(spacing).length === 0
      ? undefined
      : spacing === declared
        ? "declared"
        : "derived";
  if (Object.keys(spacing).length > 0) tokens.spacing = spacing;
  if (node.cornerRadius !== undefined) tokens.radius = { corner: node.cornerRadius };

  const fill = solidFill(node.fills);
  if (node.type === "TEXT") {
    const colors: Record<string, string> = {};
    if (fill) colors.label = fill;
    if (inheritedBackground) colors.container = inheritedBackground;
    if (Object.keys(colors).length > 0) tokens.colors = colors;
  } else if (fill) {
    tokens.colors = { container: fill };
  }

  const style = node.style;
  if (style && (style.fontSize !== undefined || style.lineHeightPx !== undefined)) {
    const text: TypographyToken = {};
    if (style.fontFamily !== undefined) text.fontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) text.fontWeight = style.fontWeight;
    if (style.fontSize !== undefined) text.fontSize = style.fontSize;
    if (style.lineHeightPx !== undefined) text.lineHeight = style.lineHeightPx;
    if (style.letterSpacing !== undefined) text.letterSpacing = style.letterSpacing;
    tokens.typography = { [styleNameOf(node, styles) ?? "text"]: text };
  }

  if (Object.keys(tokens).length === 0) return undefined;
  return spacingSource ? { tokens, spacingSource } : { tokens };
}

/** The published TEXT style a node wears, as a token key, or `undefined`. */
function styleNameOf(node: FigmaNodeDoc, styles: StyleMap | undefined): string | undefined {
  const meta = styles && node.styles?.text ? styles[node.styles.text] : undefined;
  if (meta?.styleType !== "TEXT") return undefined;
  const key = tokenPath(meta.name);
  return key === "" ? undefined : key;
}

/** File-level published-style metadata, keyed by style id (`GET /v1/files/:key`). */
export type StyleMap = Record<string, FigmaStyleMeta>;

export interface LayoutOptions {
  /**
   * The file's published-style metadata, so a text node wearing a shared style
   * is keyed by that style's name rather than the anonymous `text`.
   */
  styles?: StyleMap;
  /**
   * Source pixels per dp of this frame — see {@link SemanticTree.density}. Pass
   * it when the board's scale relative to the code is known (a 3× board is `3`),
   * so a consumer can quote the captured specs in the same unit as the render's.
   * Omit rather than guess: a wrong factor is worse than a stated `px`.
   *
   * It stamps {@link SemanticTree.boundsDensity} too, and not as a shorthand:
   * the boxes below are `absoluteBoundingBox` values, so they are in the board's
   * pixels — the very thing this factor converts — and a consumer measuring one
   * against the other side's dp needs to be told so. Left unstated, a 3× board's
   * 36px gutter reads as 36dp, and the inset corroboration in
   * `@design-parity/diff` quietly stops matching a candidate's 12.
   */
  density?: number;
}

/**
 * Build a {@link SemanticTree} from a Figma structure node, or `undefined` when
 * the node carries no `absoluteBoundingBox` (nothing to compare — the diff then
 * treats the reference as having captured no geometry, which is honest).
 *
 * Bounds are made **root-relative** and rounded to whole source pixels: Figma's
 * absolute boxes are in canvas space, where a frame sitting at x=12040 would
 * otherwise make every delta meaningless. The root's own box becomes the frame
 * on `root.bounds`, matching what the claude-design side stamps.
 */
export function layoutFromNode(
  node: FigmaNodeDoc,
  options: LayoutOptions = {},
): SemanticTree | undefined {
  const frame = node.absoluteBoundingBox;
  if (!frame) return undefined;
  const { styles, density } = options;

  const children: SemanticNode[] = [];
  const visit = (n: FigmaNodeDoc, inheritedBackground?: string): void => {
    const background = solidFill(n.fills) ?? inheritedBackground;
    // The root supplies the frame, not a matchable element.
    if (n !== node) {
      const box = n.absoluteBoundingBox;
      const label = labelOf(n);
      if (box && label) {
        const role = roleOf(n);
        const read = tokensOf(n, styles, inheritedBackground);
        children.push({
          label,
          ...(role ? { role } : {}),
          ...(read ? { tokens: read.tokens } : {}),
          ...(read?.spacingSource ? { spacingSource: read.spacingSource } : {}),
          bounds: {
            x: Math.round(box.x - frame.x),
            y: Math.round(box.y - frame.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
        });
      }
    }
    for (const child of n.children ?? []) visit(child, background);
  };
  visit(node);

  if (children.length === 0) return undefined;
  const root = tokensOf(node, styles);
  return {
    root: {
      children,
      ...(root ? { tokens: root.tokens } : {}),
      ...(root?.spacingSource ? { spacingSource: root.spacingSource } : {}),
      bounds: { x: 0, y: 0, width: Math.round(frame.width), height: Math.round(frame.height) },
    },
    ...(density !== undefined && Number.isFinite(density) && density > 0
      ? { density, boundsDensity: density }
      : {}),
  };
}
