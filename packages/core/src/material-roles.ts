/**
 * Material 3 semantic role taxonomy.
 *
 * For a Compose candidate, the vocabulary that makes a token match *meaningful*
 * is Material 3's semantic roles — colour roles (`onSurfaceVariant`), the type
 * scale (`bodyLarge`), and the shape scale (`medium`) — not a design system's
 * own token names. The candidate side already speaks this language: the renderer
 * resolves design tokens onto these roles on each node (compose-ai-tools#1897).
 *
 * This module is the canonical role list plus a conservative naming-convention
 * heuristic that recognises a reference token *named in design-system vocabulary*
 * as the Material role it denotes (`color/on-surface` → `onSurface`), so the
 * token diff can line a reference up with what the candidate resolved (issue #87).
 * The heuristic is deliberately low-confidence: it only matches names that *are*
 * a role spelling (modulo separators, casing, and a leading group segment), not
 * arbitrary design vocabulary — that's what the explicit token-alias map
 * (`DesignMap.tokens`, issue #78) is for, and it takes precedence by renaming the
 * spec before this heuristic ever runs.
 */

/** The Material 3 colour roles (the `ColorScheme` slots). */
export const MATERIAL_COLOR_ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceTint",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
  "outline",
  "outlineVariant",
  "scrim",
  "surfaceBright",
  "surfaceDim",
  "surfaceContainer",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
] as const;

/** The Material 3 type-scale roles (the `Typography` slots). */
export const MATERIAL_TYPE_ROLES = [
  "displayLarge",
  "displayMedium",
  "displaySmall",
  "headlineLarge",
  "headlineMedium",
  "headlineSmall",
  "titleLarge",
  "titleMedium",
  "titleSmall",
  "bodyLarge",
  "bodyMedium",
  "bodySmall",
  "labelLarge",
  "labelMedium",
  "labelSmall",
] as const;

/** The Material 3 shape-scale roles (the `Shapes` slots). */
export const MATERIAL_SHAPE_ROLES = [
  "none",
  "extraSmall",
  "small",
  "medium",
  "large",
  "extraLarge",
  "full",
] as const;

export type MaterialColorRole = (typeof MATERIAL_COLOR_ROLES)[number];
export type MaterialTypeRole = (typeof MATERIAL_TYPE_ROLES)[number];
export type MaterialShapeRole = (typeof MATERIAL_SHAPE_ROLES)[number];

/** Lowercase a string and drop every non-alphanumeric character. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function roleIndex<T extends string>(roles: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const role of roles) index.set(fold(role), role);
  return index;
}

const COLOR_INDEX = roleIndex(MATERIAL_COLOR_ROLES);
const TYPE_INDEX = roleIndex(MATERIAL_TYPE_ROLES);
const SHAPE_INDEX = roleIndex(MATERIAL_SHAPE_ROLES);

/**
 * The role a token name denotes, or `undefined`. A design system may express a
 * role across `/`-separated path segments (`type/body/large`) or fold it into
 * one (`body-large`); both should resolve to `bodyLarge`. So we scan suffixes of
 * the path segments **longest first** — joining `body/large` before falling back
 * to `large`, and matching `inverse/surface` as `inverseSurface` rather than the
 * shorter `surface`. A leading group segment (`color/`, `type/`) simply doesn't
 * match the full join and drops off the front.
 */
function lookupRole<T extends string>(
  index: Map<string, T>,
  name: string,
): T | undefined {
  const segments = name.split("/").filter((s) => s.length > 0);
  for (let start = 0; start < segments.length; start++) {
    const hit = index.get(fold(segments.slice(start).join("")));
    if (hit) return hit;
  }
  return undefined;
}

/** The Material colour role a token name denotes, or `undefined`. Low confidence. */
export function materialColorRole(name: string): MaterialColorRole | undefined {
  return lookupRole(COLOR_INDEX, name);
}

/** The Material type-scale role a token name denotes, or `undefined`. Low confidence. */
export function materialTypeRole(name: string): MaterialTypeRole | undefined {
  return lookupRole(TYPE_INDEX, name);
}

/** The Material shape-scale role a token name denotes, or `undefined`. Low confidence. */
export function materialShapeRole(name: string): MaterialShapeRole | undefined {
  return lookupRole(SHAPE_INDEX, name);
}
