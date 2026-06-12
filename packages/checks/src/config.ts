/**
 * Per-repo check configuration. Everything here is committed policy read
 * deterministically at run time — there is no model and no network call in any
 * check (docs/PRINCIPLES.md Principle 1).
 */
import type { Theme } from "@design-parity/core";

import { AVG_GLYPH_ADVANCE, TOUCH_TARGET } from "./thresholds.js";

export interface ChecksConfig {
  /**
   * WCAG conformance level the contrast check fails below. `"AA"` (default)
   * emits an error under AA and an info between AA and AAA; `"AAA"` emits an
   * error under AAA.
   */
  contrastLevel?: "AA" | "AAA";
  /** Minimum touch-target size in dp (default {@link TOUCH_TARGET.min}). */
  minTouchTarget?: number;
  /** Average glyph advance as a fraction of font size for width estimation. */
  glyphAdvance?: number;
  /** Themes to evaluate; defaults to those the candidate exposes. */
  themes?: Theme[];
  /**
   * Flag every user-facing literal as a possible un-keyed string. Off by
   * default: a render alone can't prove a string came from a resource, so this
   * is an opt-in lint, not a steady-state gate.
   */
  flagHardcodedStrings?: boolean;
}

/** Config with all optional knobs resolved to concrete defaults. */
export interface ResolvedConfig {
  contrastLevel: "AA" | "AAA";
  minTouchTarget: number;
  glyphAdvance: number;
  themes?: Theme[];
  flagHardcodedStrings: boolean;
}

export function resolveConfig(config: ChecksConfig = {}): ResolvedConfig {
  return {
    contrastLevel: config.contrastLevel ?? "AA",
    minTouchTarget: config.minTouchTarget ?? TOUCH_TARGET.min,
    glyphAdvance: config.glyphAdvance ?? AVG_GLYPH_ADVANCE,
    themes: config.themes,
    flagHardcodedStrings: config.flagHardcodedStrings ?? false,
  };
}
