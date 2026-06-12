/**
 * Committed thresholds for the a11y + i18n checks.
 *
 * These are the *policy* — the deterministic rules and numbers the checks read
 * at run time (docs/PRINCIPLES.md Principle 1: no model in the loop, only
 * committed config). Override per-repo via {@link ChecksConfig}; the defaults
 * here encode WCAG 2.2 + Material 3 + standard pseudolocale guidance.
 */

/** WCAG contrast minimums, by conformance level and text size. */
export const CONTRAST = {
  /** Normal text, WCAG 1.4.3 (AA). */
  aaNormal: 4.5,
  /** Large text, WCAG 1.4.3 (AA). */
  aaLarge: 3.0,
  /** Normal text, WCAG 1.4.6 (AAA). */
  aaaNormal: 7.0,
  /** Large text, WCAG 1.4.6 (AAA). */
  aaaLarge: 4.5,
} as const;

/**
 * "Large text" per WCAG: ≥ 18pt, or ≥ 14pt when bold. Token font sizes are in
 * sp/px which we treat as pt-equivalent for the size test (the candidate render
 * reports logical units, not device pixels).
 */
export const LARGE_TEXT = {
  minPt: 18,
  minBoldPt: 14,
  /** Weight at or above which text counts as bold for the size test. */
  boldWeight: 700,
} as const;

/**
 * Touch-target minimums (dp). Material 3 recommends 48dp; WCAG 2.5.8 (AA) sets
 * a hard floor of 24px. Below `min` warns; below `aaFloor` is an outright AA
 * failure (error).
 */
export const TOUCH_TARGET = {
  min: 48,
  aaFloor: 24,
} as const;

/** Roles that are interactive and therefore must expose an accessible name. */
export const INTERACTIVE_ROLES = [
  "button",
  "link",
  "switch",
  "checkbox",
  "radio",
  "textfield",
  "menuitem",
  "tab",
  "slider",
] as const;

/**
 * Roles whose nodes must carry an accessible label / content description even
 * when not interactive (e.g. a meaningful image).
 */
export const LABEL_REQUIRED_ROLES = [
  ...INTERACTIVE_ROLES,
  "image",
] as const;

/**
 * Pseudolocale text-expansion factors by source (English) string length, in
 * characters. Short strings grow the most. Mirrors the widely used CLDR /
 * Android `en-XA` guidance (≈ doubling for short labels). The check multiplies
 * an estimated rendered width by these and compares against available width.
 */
export function expansionFactor(length: number): number {
  if (length <= 10) return 2.0;
  if (length <= 20) return 1.8;
  if (length <= 30) return 1.6;
  if (length <= 50) return 1.4;
  return 1.3;
}

/**
 * Average glyph advance as a fraction of font size, for a proportional Latin
 * font. Used to estimate rendered text width from a label string without a
 * font engine. Deliberately approximate — text-expansion findings are `warn`
 * (risk), never `error`.
 */
export const AVG_GLYPH_ADVANCE = 0.55;

/**
 * Patterns that look like hardcoded, locale-specific value formatting embedded
 * in a user-facing string. These should go through locale-aware formatters.
 */
export const LOCALE_FORMAT_PATTERNS: { readonly id: string; readonly re: RegExp }[] = [
  // $1,234  £9.99  €1 234,50  ¥980
  { id: "currency", re: /[$£€¥₹]\s?\d/u },
  // 12/06/2026  2026-06-12  6.12.26
  { id: "date", re: /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/u },
  // 1,234,567  1.234,56  (grouped / fractional numbers)
  { id: "number", re: /\b\d{1,3}([.,]\d{3})+([.,]\d+)?\b/u },
] as const;

/**
 * Label hints for directional iconography that must mirror under RTL. A `back`
 * chevron pointing left in LTR has to point right in RTL; flagged so the author
 * confirms a mirroring/auto-mirror is in place.
 */
export const RTL_DIRECTIONAL_HINT =
  /(?:^|[\s_-])(back|forward|next|prev(?:ious)?|chevron|caret|arrow)(?:[\s_-](?:left|right|start|end))?(?:$|[\s_-])/iu;

/** Strong RTL scripts (Hebrew, Arabic, Syriac, Thaana, NKo). */
export const STRONG_RTL_CHARS =
  /[֐-׿؀-ۿ܀-ݏހ-޿߀-߿]/u;
