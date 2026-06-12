/**
 * Helpers for walking a {@link SemanticTree} and resolving theme-aware colors,
 * accessible names, and text size from token conventions. Shared by the a11y
 * and i18n checks. Pure and deterministic.
 */
import type {
  SemanticNode,
  Theme,
  TypographyToken,
} from "@design-parity/core";

import { LARGE_TEXT } from "./thresholds.js";

/** A node paired with its ancestors, nearest first (parent … root). */
export interface NodeWithPath {
  node: SemanticNode;
  /** Ancestors ordered nearest-first: `[parent, grandparent, …, root]`. */
  ancestors: SemanticNode[];
}

/** Pre-order walk yielding every node with its ancestor chain. */
export function walk(root: SemanticNode): NodeWithPath[] {
  const out: NodeWithPath[] = [];
  const visit = (node: SemanticNode, ancestors: SemanticNode[]) => {
    out.push({ node, ancestors });
    for (const child of node.children ?? []) {
      visit(child, [node, ...ancestors]);
    }
  };
  visit(root, []);
  return out;
}

/** Which side of a contrast pair a color token name denotes. */
export type ColorRole = "fg" | "bg";

const BG_NAME = /(?:^|[._-])(container|background|surface|bg|fill)(?:$|[._-])/i;
const FG_NAME =
  /(?:^|[._-])(label|text|foreground|fg|on[._-]?\w*|content|title|body|icon)(?:$|[._-])/i;

/** Split a token key like `container.dark` into its base name and theme. */
export function splitThemeKey(key: string): { base: string; theme?: Theme } {
  const m = /^(.*)[._-](light|dark)$/i.exec(key);
  if (!m) return { base: key };
  return { base: m[1]!, theme: m[2]!.toLowerCase() as Theme };
}

/** Classify a color token key as foreground, background, or neither. */
export function classifyColor(key: string): ColorRole | undefined {
  const { base } = splitThemeKey(key);
  if (BG_NAME.test(base)) return "bg";
  if (FG_NAME.test(base)) return "fg";
  return undefined;
}

/**
 * Resolve the color for `role` under `theme`, searching `node` then its
 * ancestors (nearest first). A theme-suffixed token only applies to its theme;
 * an unsuffixed token applies to every theme. Theme-specific wins over generic
 * at the same level.
 */
export function resolveColorUp(
  entry: NodeWithPath,
  role: ColorRole,
  theme: Theme,
): string | undefined {
  for (const node of [entry.node, ...entry.ancestors]) {
    const colors = node.tokens?.colors;
    if (!colors) continue;
    let generic: string | undefined;
    for (const [key, value] of Object.entries(colors)) {
      if (classifyColor(key) !== role) continue;
      const { theme: keyTheme } = splitThemeKey(key);
      if (keyTheme === theme) return value; // most specific
      if (keyTheme === undefined) generic ??= value;
    }
    if (generic !== undefined) return generic;
  }
  return undefined;
}

/** The accessible name exposed by a node, if any. */
export function accessibleName(node: SemanticNode): string | undefined {
  const label = node.label?.trim();
  return label ? label : undefined;
}

/** WCAG "large text": ≥18pt, or ≥14pt bold. */
export function isLargeText(typo: TypographyToken | undefined): boolean {
  if (!typo?.fontSize) return false;
  const bold = isBold(typo.fontWeight);
  if (bold && typo.fontSize >= LARGE_TEXT.minBoldPt) return true;
  return typo.fontSize >= LARGE_TEXT.minPt;
}

/** The first typography token defined on a node, if any. */
export function firstTypography(
  node: SemanticNode,
): TypographyToken | undefined {
  const typo = node.tokens?.typography;
  if (!typo) return undefined;
  for (const value of Object.values(typo)) return value;
  return undefined;
}

/** Themes a candidate exposes, derived from the color tokens present. */
export function themesInTree(root: SemanticNode): Theme[] {
  const themes = new Set<Theme>();
  for (const { node } of walk(root)) {
    for (const key of Object.keys(node.tokens?.colors ?? {})) {
      const { theme } = splitThemeKey(key);
      if (theme) themes.add(theme);
    }
  }
  return themes.size ? [...themes].sort() : ["light"];
}

function isBold(weight: TypographyToken["fontWeight"]): boolean {
  if (typeof weight === "number") return weight >= LARGE_TEXT.boldWeight;
  if (typeof weight === "string") {
    if (/^\d+$/.test(weight)) return Number(weight) >= LARGE_TEXT.boldWeight;
    return /bold|black|heavy/i.test(weight);
  }
  return false;
}
