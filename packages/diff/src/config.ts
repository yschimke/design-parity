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
   * Max per-axis dimension delta (px) between reference and candidate that is
   * still diffed as an aligned overlap rather than scored a 100% mismatch. Two
   * render tools rounding density differently (e.g. Robolectric 2.625 vs a
   * `deviceScaleFactor=2` capture) can differ by a pixel or two without any real
   * visual drift; tolerating that keeps the heatmap informative (#47). A delta
   * beyond this on either axis is a genuine total mismatch.
   */
  visualDimTolerancePx: number;
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
  visualDimTolerancePx: 8,
};

/** Merge a partial override over the committed defaults. */
export function resolveConfig(override?: Partial<DiffConfig>): DiffConfig {
  if (!override) return defaultDiffConfig;
  return { ...defaultDiffConfig, ...override };
}
