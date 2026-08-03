/**
 * Pure mapping from Figma REST structures to a {@link DesignReference}. No I/O —
 * the adapter does the fetching and hands the parsed structures here.
 */
import type {
  DesignReference,
  DesignTokens,
  Image,
  TypographyToken,
} from "@design-parity/core";

import type {
  FigmaColor,
  FigmaNodeDoc,
  FigmaPaint,
  FigmaStyleMeta,
  VariablesResponse,
} from "./figma-api.js";
import { layoutFromNode } from "./layout.js";

function hex(c: FigmaColor): string {
  const ch = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  const base = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  return c.a < 1 ? `${base}${ch(c.a)}` : base;
}

function solidFill(fills: FigmaPaint[] | undefined): string | undefined {
  const paint = fills?.find(
    (p) => p.type === "SOLID" && p.visible !== false && p.color,
  );
  return paint?.color ? hex(paint.color) : undefined;
}

function firstTextNode(node: FigmaNodeDoc): FigmaNodeDoc | undefined {
  if (node.type === "TEXT") return node;
  for (const child of node.children ?? []) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return undefined;
}

/** Take the last `/`-delimited segment of a variable name and normalize it. */
function varKey(name: string): string {
  return name
    .slice(name.lastIndexOf("/") + 1)
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * Normalize a full token path, keeping its `/` segments (so the diff's Material
 * role lookup can read `radius/medium` → `medium`, `Body/Large` → `bodyLarge`):
 * trim + lowercase each segment, collapse inner whitespace to `-`.
 */
function tokenPath(name: string): string {
  return name
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, "-").toLowerCase())
    .filter(Boolean)
    .join("/");
}

/** Map COLOR variables → `colors["<name>.<mode>"]` across every mode. */
function colorsFromVariables(
  variables: VariablesResponse,
): Record<string, string> {
  const out: Record<string, string> = {};
  const meta = variables.meta;
  if (!meta) return out;

  for (const collection of Object.values(meta.variableCollections)) {
    const modeName = new Map(collection.modes.map((m) => [m.modeId, m.name]));
    for (const id of collection.variableIds) {
      const variable = meta.variables[id];
      if (!variable || variable.resolvedType !== "COLOR") continue;
      const key = varKey(variable.name);
      for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
        // Skip aliases — only concrete colors carry an {r,g,b,a}.
        if (value && typeof value === "object" && "r" in value) {
          const mode = modeName.get(modeId)?.toLowerCase() ?? modeId;
          out[`${key}.${mode}`] = hex(value as FigmaColor);
        }
      }
    }
  }
  return out;
}

const RADIUS_HINT = /^(radius|radii|corner|corners|rounding|round|rounded)$/;
const SPACING_HINT = /^(space|spacing|spaces|gap|gaps|inset|insets|padding|margin|margins)$/;

/** Does any `/`-segment of `name` (or the collection name) match `hint`? */
function hints(hint: RegExp, ...names: string[]): boolean {
  return names.some((name) =>
    name.split("/").some((seg) => hint.test(seg.trim().toLowerCase())),
  );
}

/**
 * Classify a FLOAT Variable as a `radius` or `spacing` system token from its
 * (and its collection's) name. Deliberately conservative — a FLOAT with neither
 * hint is left out rather than guessed onto the wrong scale, since mis-tagging a
 * spacing value as a radius (or vice-versa) is worse than not extracting it.
 */
function classifyFloat(
  varName: string,
  collectionName: string,
): "radius" | "spacing" | undefined {
  if (hints(RADIUS_HINT, varName, collectionName)) return "radius";
  if (hints(SPACING_HINT, varName, collectionName)) return "spacing";
  return undefined;
}

/**
 * Map FLOAT Variables → `{ spacing, radius }`, keyed by their full token path.
 * Each variable is resolved at its collection's **default mode** — a spacing or
 * radius scale doesn't vary by light/dark, so (unlike colours) these carry no
 * `<mode>` suffix and compare directly against the resolved code theme.
 */
function numericFromVariables(variables: VariablesResponse): {
  spacing?: Record<string, number>;
  radius?: Record<string, number>;
} {
  const spacing: Record<string, number> = {};
  const radius: Record<string, number> = {};
  const meta = variables.meta;
  if (!meta) return {};

  for (const collection of Object.values(meta.variableCollections)) {
    for (const id of collection.variableIds) {
      const variable = meta.variables[id];
      if (!variable || variable.resolvedType !== "FLOAT") continue;
      const value = variable.valuesByMode[collection.defaultModeId];
      if (typeof value !== "number") continue; // skip aliases / non-concrete
      const group = classifyFloat(variable.name, collection.name);
      if (!group) continue;
      const key = tokenPath(variable.name);
      (group === "radius" ? radius : spacing)[key] = value;
    }
  }

  const out: { spacing?: Record<string, number>; radius?: Record<string, number> } = {};
  if (Object.keys(spacing).length) out.spacing = spacing;
  if (Object.keys(radius).length) out.radius = radius;
  return out;
}

function typographyFrom(text: FigmaNodeDoc | undefined): TypographyToken | undefined {
  const s = text?.style;
  if (!s) return undefined;
  const token: TypographyToken = {};
  if (s.fontFamily !== undefined) token.fontFamily = s.fontFamily;
  if (s.fontSize !== undefined) token.fontSize = s.fontSize;
  if (s.fontWeight !== undefined) token.fontWeight = s.fontWeight;
  if (s.lineHeightPx !== undefined) token.lineHeight = Math.round(s.lineHeightPx);
  if (s.letterSpacing !== undefined) token.letterSpacing = s.letterSpacing;
  return Object.keys(token).length ? token : undefined;
}

function tokensFrom(node: FigmaNodeDoc): DesignTokens | undefined {
  const tokens: DesignTokens = {};

  const padding = node.paddingLeft ?? node.paddingTop ?? node.paddingRight ?? node.paddingBottom;
  if (padding !== undefined) tokens.spacing = { padding };

  if (node.cornerRadius !== undefined) tokens.radius = { corner: node.cornerRadius };

  // Per-node colours: the frame's own fill and its first text colour. The
  // design-system palette (Variables) lives in `themeTokens`, not here.
  const colors: Record<string, string> = {};
  const container = solidFill(node.fills);
  if (container) colors.container = container;
  const text = firstTextNode(node);
  const label = solidFill(text?.fills);
  if (label) colors.label = label;
  if (Object.keys(colors).length) tokens.colors = colors;

  const typography = typographyFrom(text);
  if (typography) tokens.typography = { label: typography };

  return Object.keys(tokens).length ? tokens : undefined;
}

/**
 * The design-system type ramp: every shared **TEXT** style referenced by a TEXT
 * node in the component subtree, keyed by its published style name (`Body/Large`
 * → `body/large`). Figma exposes a text style's resolved properties only through
 * a node that uses it, so this captures the styles the component actually wears —
 * the diff's Material-type-role mapping (`body/large` → `bodyLarge`) then lines
 * them up with the code theme's type scale.
 */
function typographyFromStyles(
  node: FigmaNodeDoc,
  styles: Record<string, FigmaStyleMeta> | undefined,
): Record<string, TypographyToken> {
  const out: Record<string, TypographyToken> = {};
  if (!styles) return out;
  const visit = (n: FigmaNodeDoc): void => {
    const styleId = n.styles?.text;
    const meta = styleId ? styles[styleId] : undefined;
    if (meta?.styleType === "TEXT") {
      const token = typographyFrom(n);
      const key = tokenPath(meta.name);
      if (token && key && !(key in out)) out[key] = token; // first occurrence wins
    }
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

/**
 * The design-system table: every COLOR Variable (keyed `<name>.<mode>`), the
 * FLOAT spacing/radius scale, and the text-style type ramp. Absent when the
 * source exposes none of these.
 */
function themeTokensFrom(
  node: FigmaNodeDoc,
  variables: VariablesResponse,
  styles: Record<string, FigmaStyleMeta> | undefined,
): DesignTokens | undefined {
  const out: DesignTokens = {};
  const colors = colorsFromVariables(variables);
  if (Object.keys(colors).length) out.colors = colors;

  const numeric = numericFromVariables(variables);
  if (numeric.spacing) out.spacing = numeric.spacing;
  if (numeric.radius) out.radius = numeric.radius;

  const typography = typographyFromStyles(node, styles);
  if (Object.keys(typography).length) out.typography = typography;

  return Object.keys(out).length ? out : undefined;
}

export interface NormalizeInput {
  componentId: string;
  ref: string;
  /** Structure node used for token extraction (padding, radius, fills, text). */
  node: FigmaNodeDoc;
  variables: VariablesResponse;
  /** File-level published-style metadata (style id → name/type) for the node. */
  styles?: Record<string, FigmaStyleMeta>;
  referenceImages: Image[];
}

/** Build a `DesignReference` with `linkMethod: "code-connect"`. */
export function normalizeReference(input: NormalizeInput): DesignReference {
  const tokens = tokensFrom(input.node);
  const themeTokens = themeTokensFrom(input.node, input.variables, input.styles);
  const ref: DesignReference = {
    componentId: input.componentId,
    source: "figma",
    linkMethod: "code-connect",
    ref: input.ref,
    referenceImages: input.referenceImages,
  };
  if (tokens) ref.tokens = tokens;
  if (themeTokens) ref.themeTokens = themeTokens;
  const layout = layoutFromNode(input.node);
  if (layout) ref.layout = layout;
  return ref;
}
