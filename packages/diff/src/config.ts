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
}

/** The committed defaults: exact-match tokens, sensitive visual diff. */
export const defaultDiffConfig: DiffConfig = {
  spacingTolerance: 0,
  radiusTolerance: 0,
  pixelThreshold: 0.05,
  visualWarnRatio: 0,
};

/** Merge a partial override over the committed defaults. */
export function resolveConfig(override?: Partial<DiffConfig>): DiffConfig {
  if (!override) return defaultDiffConfig;
  return { ...defaultDiffConfig, ...override };
}
