/**
 * Diff thresholds and rules.
 *
 * Per docs/PRINCIPLES.md (Principle 1) every threshold the engine uses is
 * committed config, never inferred at run time. A consumer overrides any field;
 * the rest fall back to {@link defaultDiffConfig}. The same config in → the same
 * verdict out.
 *
 * a11y + i18n thresholds (contrast levels, touch-target sizes, expansion
 * factors) are *not* here — they belong to `@design-parity/checks` and are
 * configured through {@link DiffOptions.checksConfig}.
 */

export interface DiffConfig {
  /** Max allowed absolute delta (dp/px) for a spacing token before it fails. */
  spacingTolerance: number;
  /** Max allowed absolute delta (dp/px) for a radius token before it fails. */
  radiusTolerance: number;
  /**
   * pixelmatch per-pixel matching threshold (0 strict … 1 loose). Pixels whose
   * colour distance exceeds this fraction are counted as differing. Tighter
   * than pixelmatch's 0.1 default so a visible theme-colour drift registers.
   */
  pixelThreshold: number;
  /**
   * Fraction of differing pixels (0…1) above which an image pair raises a
   * visual finding. Visual diff is the least-valuable signal (Principle 2), so
   * it never escalates past `warn`.
   */
  visualWarnRatio: number;
  /**
   * Minimum reference alpha (0…1) for a pixel to count as opaque in the
   * directional alpha-loss diagnostic.
   */
  visualAlphaOpaqueThreshold: number;
  /**
   * Maximum candidate alpha (0…1) for a pixel to count as transparent in the
   * directional alpha-loss diagnostic.
   */
  visualAlphaTransparentThreshold: number;
  /**
   * Fraction of aligned pixels (0…1) that must be opaque in the reference and
   * transparent in the candidate before a directional alpha-loss finding is
   * raised. The finding remains an advisory visual warning.
   */
  visualAlphaLossWarnRatio: number;
  /**
   * Max per-axis dimension delta (px) between reference and candidate that
   * counts as *density rounding* rather than a real size difference. Two render
   * tools rounding density differently (e.g. Robolectric 2.625 vs a
   * `deviceScaleFactor=2` capture) can differ by a pixel or two without any real
   * visual drift, and that shouldn't read as a defect (#47).
   *
   * This affects only how the size difference is *reported* — info below the
   * threshold, `warn` (with both frame sizes) above it. Mismatched pairs are
   * always diffed over their shared top-left overlap regardless: a delta past
   * the threshold used to be written off as a flat 100%, which discarded a
   * usable measurement precisely when the drift was largest.
   */
  visualDimTolerancePx: number;
  /**
   * Max allowed per-axis position/size delta (dp) between a reference element
   * and its matched candidate element before the layout diff flags it. Surfaces
   * padding/spacer/size mismatches structurally — element by element — rather
   * than leaving them to the pixel heatmap. Bounds are measured back from a
   * render on each side, so a small allowance absorbs sub-pixel/density rounding
   * like {@link visualDimTolerancePx}; a real spacer error (≥ a few dp) clears it.
   */
  layoutTolerance: number;
  /**
   * What a numeric spec token the candidate reports **no value at all** for is
   * worth. `"advisory"` (the default) reports it as a non-blocking `info`;
   * `"strict"` restores the historical hard `missing` error.
   *
   * "The candidate has no value for this token" and "the candidate has a value
   * and it is wrong" are different states, and only the second is evidence of
   * divergence — the reasoning {@link unverifiableGroup} already applies when a
   * candidate resolves a whole group of nothing (issue #368). A candidate that
   * resolves *some* spacing but cannot report `padding` is in the same state as
   * one that resolved no spacing, and used to be the only case where a single
   * unreportable token decided the verdict. Wear is the worked example: a
   * component sized by `touchTargetAwareSize` plus a sized child declares no
   * padding modifier, and adding one to clear the check would misrepresent how
   * the library composes.
   *
   * A value the candidate *does* report stays strict at either setting: that is
   * the comparison worth running.
   */
  missingNumerics: "advisory" | "strict";
  /**
   * Whether a derived inset whose measurement is set by a **text** child counts
   * as padding. `"skip"` (the default) drops it; `"measure"` restores the
   * historical behaviour of reporting it like any other.
   *
   * {@link collectDerivedInsets} measures the gap between a container and the
   * union of its children — a sound proxy for padding when the child is a box,
   * which is the icon-button case it was written for. When the child is text the
   * gap is a function of the font, the string, and its line height, so quoting
   * it against a declared auto-layout padding compares two unrelated quantities
   * (issue #367).
   */
  textDerivedInsets: "skip" | "measure";
}

/**
 * The committed defaults: near-exact tokens, sensitive visual diff.
 *
 * Spacing/radius carry a **1dp** allowance because a candidate's token values are
 * measured back from pixel bounds, so they inherit the renderer's density
 * rounding — an 18dp circle radius captured at 2.625× comes back as `18.1dp`, a
 * 16dp gap may land a fraction off. This mirrors {@link visualDimTolerancePx}'s
 * rationale on the visual side; 1dp absorbs that snap while still failing real
 * drift (design tokens snap to a ≥2dp grid, so a true difference clears it).
 */
export const defaultDiffConfig: DiffConfig = {
  spacingTolerance: 1,
  radiusTolerance: 1,
  pixelThreshold: 0.05,
  visualWarnRatio: 0,
  visualAlphaOpaqueThreshold: 0.9,
  visualAlphaTransparentThreshold: 0.1,
  visualAlphaLossWarnRatio: 0.01,
  visualDimTolerancePx: 8,
  layoutTolerance: 4,
  missingNumerics: "advisory",
  textDerivedInsets: "skip",
};

/** Merge a partial override over the committed defaults. */
export function resolveConfig(override?: Partial<DiffConfig>): DiffConfig {
  if (!override) return defaultDiffConfig;
  return { ...defaultDiffConfig, ...override };
}
