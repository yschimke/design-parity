/**
 * Variant names as axis vectors.
 *
 * A component set's children are named `Type=Round, Size=Small, State=Enabled` —
 * that is not a label, it is a point in the set's property space, and Figma
 * guarantees every child names every axis. So "the same component with one axis
 * changed" is a lookup rather than a search: change one component of the vector
 * and the sibling that carries it is the one whose name matches.
 *
 * Pure string handling, no I/O — the adapter supplies the nodes.
 */

/** An axis vector parsed from a variant name, in the name's own order. */
export type VariantAxes = Map<string, string>;

/**
 * Parse `Type=Round, Size=Small` into `{Type: Round, Size: Small}`.
 *
 * Returns an empty map for a name that is not an axis vector (a plain component
 * name, a frame), so a caller can treat "no axes" and "not a variant" alike —
 * both mean there is nothing to step along.
 */
export function parseVariantName(name: string): VariantAxes {
  const axes: VariantAxes = new Map();
  for (const part of name.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const axis = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (axis && value) axes.set(axis, value);
  }
  return axes;
}

/** Render an axis vector back to Figma's `A=1, B=2` spelling (input order). */
export function formatVariantName(axes: VariantAxes): string {
  return [...axes].map(([axis, value]) => `${axis}=${value}`).join(", ");
}

/**
 * Look an axis up case-insensitively, returning the key as the *source* spells
 * it. Consumers name axes in their own casing (`size`), and the source's
 * spelling (`Size`) is the one that has to go back into a name.
 */
export function canonicalAxis(
  axes: Iterable<string>,
  axis: string,
): string | undefined {
  const wanted = axis.trim().toLowerCase();
  for (const candidate of axes) {
    if (candidate.trim().toLowerCase() === wanted) return candidate;
  }
  return undefined;
}

/** Do two axis vectors agree on every axis, ignoring order and case of names? */
export function sameAxes(a: VariantAxes, b: VariantAxes): boolean {
  if (a.size !== b.size) return false;
  for (const [axis, value] of a) {
    const key = canonicalAxis(b.keys(), axis);
    if (key === undefined) return false;
    if ((b.get(key) ?? "").toLowerCase() !== value.toLowerCase()) return false;
  }
  return true;
}
