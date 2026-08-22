/**
 * Density normalisation at the report's entry.
 *
 * A {@link SemanticTree} states its scale rather than applying it:
 * {@link SemanticTree.density} is source pixels per dp for the values in
 * `tokens`, and consumers divide through. `@design-parity/catalog-export` does;
 * the Figma adapter does it for the *top-level* `reference.tokens` the token
 * diff reads. The report reads the other half — the captured `layout` tree —
 * and, before this, quoted its numbers raw: a 3× board reached the panels as
 * `42sp` / `p48` against a candidate's `14sp` / `p16` while the verdict beside
 * them called the same pair a match. A report contradicting its own verdict is
 * worse than both sides being raw, which is what it was before the factor
 * reached the adapter at all (issue #379).
 *
 * Normalising once here beats teaching `typography.ts`, `overlay.ts` and
 * `render.ts` each about density: every reader downstream sees one unit system,
 * and there is one place to be right about what scales.
 *
 * **Only `tokens` scale.** `bounds` are anchors in whatever pixel space the
 * annotated image is in — a publisher rescales them to the raster it draws over
 * without touching the specs those boxes describe — so they stay put, and the
 * overlay keeps drawing in the captured raster's space. Their factor is the
 * independent {@link SemanticTree.boundsDensity}, which governs what the
 * overlay *prints* for a box, not where it draws it.
 *
 * An unstated density leaves the tree exactly as captured, object identity
 * included. That is not a guess at 1×: it is the documented reading of an
 * unstated scale, and it is what keeps every project that has not declared a
 * board density seeing precisely the report it saw before.
 */
import type {
  DesignTokens,
  SemanticNode,
  SemanticTree,
  TypographyToken,
} from "@design-parity/core";

/**
 * Rounded to two places, matching the adapter's own division: a divided-through
 * capture is a measurement, not a spec, and `48 / 2.625 = 18.285714…` quoted in
 * full is false precision.
 */
function inDp(value: number, density: number): number {
  return Math.round((value / density) * 100) / 100;
}

/** Usable scale factor, or `undefined` for "not stated" / not a scale. */
export function statedDensity(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * Lengths only. `fontWeight` is a weight, `fontFamily` / `fontStyle` /
 * `fontVariationSettings` are not measurements, and none of them scale.
 */
function typographyInDp(type: TypographyToken, density: number): TypographyToken {
  const out: TypographyToken = { ...type };
  if (type.fontSize !== undefined) out.fontSize = inDp(type.fontSize, density);
  if (type.lineHeight !== undefined) out.lineHeight = inDp(type.lineHeight, density);
  if (type.letterSpacing !== undefined) out.letterSpacing = inDp(type.letterSpacing, density);
  return out;
}

/** Spacing, radius and type sizes divide; colours are not lengths. */
function tokensInDp(tokens: DesignTokens, density: number): DesignTokens {
  const out: DesignTokens = { ...tokens };
  if (tokens.spacing) {
    out.spacing = Object.fromEntries(
      Object.entries(tokens.spacing).map(([k, v]) => [k, inDp(v, density)]),
    );
  }
  if (tokens.radius) {
    out.radius = Object.fromEntries(
      Object.entries(tokens.radius).map(([k, v]) => [k, inDp(v, density)]),
    );
  }
  if (tokens.typography) {
    out.typography = Object.fromEntries(
      Object.entries(tokens.typography).map(([k, v]) => [k, typographyInDp(v, density)]),
    );
  }
  return out;
}

function nodeInDp(node: SemanticNode, density: number): SemanticNode {
  return {
    ...node,
    ...(node.tokens ? { tokens: tokensInDp(node.tokens, density) } : {}),
    ...(node.children ? { children: node.children.map((c) => nodeInDp(c, density)) } : {}),
  };
}

/**
 * Put a tree's `tokens` in code units (dp/sp), leaving `bounds` alone.
 *
 * The result drops `density`, because after the division there is no factor
 * left to state and "absent" is the contract's word for tokens that already
 * share the code side's space — which also makes this idempotent. `bounds` and
 * `boundsDensity` pass through untouched: they are the other half of the tree
 * and the overlay still needs them in the raster's own pixels.
 */
export function inCodeUnits(tree: SemanticTree | undefined): SemanticTree | undefined {
  if (!tree) return tree;
  const density = statedDensity(tree.density);
  if (density === undefined) return tree;
  const { density: _stated, ...rest } = tree;
  return { ...rest, root: nodeInDp(tree.root, density) };
}
