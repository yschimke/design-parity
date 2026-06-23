/**
 * Canonical image size vocabulary.
 *
 * `Image.size` is a free `string` so sources can carry their own breakpoint
 * labels, but the diff engine pairs candidate↔reference images by
 * `state/theme/size`. Without a shared vocabulary the two sides drift ("md" vs
 * "medium" vs a px width) and images silently fail to pair. {@link normalizeSize}
 * maps any producer's label onto one canonical set so they line up.
 */

/** The canonical breakpoint set — Material 3 window-size classes. */
export type CanonicalSize = "compact" | "medium" | "expanded";

export const CANONICAL_SIZES: readonly CanonicalSize[] = [
  "compact",
  "medium",
  "expanded",
];

/** Width (dp) at/above which a window leaves the smaller class (Material 3). */
export const SIZE_BREAKPOINTS = { medium: 600, expanded: 840 } as const;

/** Classify a window width (dp) into its canonical size. */
export function sizeForWidth(widthDp: number): CanonicalSize {
  if (widthDp < SIZE_BREAKPOINTS.medium) return "compact";
  if (widthDp < SIZE_BREAKPOINTS.expanded) return "medium";
  return "expanded";
}

/**
 * Normalize a size label or width to a {@link CanonicalSize}.
 *
 * - a number, or a numeric string (`"600"`, `"600dp"`, `"840px"`) → classified
 *   by the Material breakpoints;
 * - a canonical name (any case) → itself;
 * - anything else (a custom/unknown label, `null`/`undefined`) → `undefined`, so
 *   the caller can keep the original rather than guess.
 *
 * `null` is accepted as well as `undefined` because preview bundles serialize an
 * unset width as JSON `null` (e.g. a `@Preview` with no `widthDp`), and the
 * candidate reader passes `params.widthDp` straight through.
 */
export function normalizeSize(
  input: number | string | null | undefined,
): CanonicalSize | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") {
    return Number.isFinite(input) ? sizeForWidth(input) : undefined;
  }
  const s = input.trim().toLowerCase();
  if (s === "") return undefined;
  if ((CANONICAL_SIZES as readonly string[]).includes(s)) {
    return s as CanonicalSize;
  }
  const n = Number(s.replace(/(dp|px)$/i, "").trim());
  return Number.isFinite(n) ? sizeForWidth(n) : undefined;
}
