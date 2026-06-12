/**
 * The opinionated token baseline for a repo with no design system (rung 3).
 *
 * Material 3 + WCAG AA by construction: the foreground/background color pairs
 * below are the M3 baseline roles, chosen so each on-* color clears AA (4.5:1)
 * against its container. The spacing, radius, and type scales are the M3
 * defaults. This is a *starting point* a human reviews and commits — not a
 * decision re-made on every run (Principle 1).
 */
import type { DesignTokens } from "@design-parity/core";

/**
 * Generate the baseline {@link DesignTokens}. Returns a fresh object each call
 * so callers can safely mutate before writing.
 */
export function materialBaselineTokens(): DesignTokens {
  return {
    // M3 4dp spacing grid.
    spacing: {
      none: 0,
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      "2xl": 32,
      "3xl": 48,
    },
    // M3 baseline color roles. Each on-* clears WCAG AA against its container.
    colors: {
      primary: "#6750A4",
      onPrimary: "#FFFFFF",
      primaryContainer: "#EADDFF",
      onPrimaryContainer: "#21005D",
      secondary: "#625B71",
      onSecondary: "#FFFFFF",
      error: "#B3261E",
      onError: "#FFFFFF",
      background: "#FFFBFE",
      onBackground: "#1C1B1F",
      surface: "#FFFBFE",
      onSurface: "#1C1B1F",
      surfaceVariant: "#E7E0EC",
      onSurfaceVariant: "#49454F",
      outline: "#79747E",
    },
    // M3 shape scale (corner radii, dp).
    radius: {
      none: 0,
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 28,
      full: 9999,
    },
    // M3 type scale (subset: one role per size tier).
    typography: {
      displayLarge: { fontSize: 57, fontWeight: 400, lineHeight: 64, letterSpacing: -0.25 },
      headlineMedium: { fontSize: 28, fontWeight: 400, lineHeight: 36 },
      titleLarge: { fontSize: 22, fontWeight: 400, lineHeight: 28 },
      bodyLarge: { fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0.5 },
      bodyMedium: { fontSize: 14, fontWeight: 400, lineHeight: 20, letterSpacing: 0.25 },
      labelLarge: { fontSize: 14, fontWeight: 500, lineHeight: 20, letterSpacing: 0.1 },
    },
  };
}
