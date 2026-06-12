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
  VariablesResponse,
} from "./figma-api.js";

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

function tokensFrom(
  node: FigmaNodeDoc,
  variables: VariablesResponse,
): DesignTokens | undefined {
  const tokens: DesignTokens = {};

  const padding = node.paddingLeft ?? node.paddingTop ?? node.paddingRight ?? node.paddingBottom;
  if (padding !== undefined) tokens.spacing = { padding };

  if (node.cornerRadius !== undefined) tokens.radius = { corner: node.cornerRadius };

  const colors: Record<string, string> = colorsFromVariables(variables);
  const container = solidFill(node.fills);
  // Only fall back to the node fill when variables didn't supply a container.
  if (container && !Object.keys(colors).some((k) => k.startsWith("container")))
    colors.container = container;
  const text = firstTextNode(node);
  const label = solidFill(text?.fills);
  if (label) colors.label = label;
  if (Object.keys(colors).length) tokens.colors = colors;

  const typography = typographyFrom(text);
  if (typography) tokens.typography = { label: typography };

  return Object.keys(tokens).length ? tokens : undefined;
}

export interface NormalizeInput {
  componentId: string;
  ref: string;
  /** Structure node used for token extraction (padding, radius, fills, text). */
  node: FigmaNodeDoc;
  variables: VariablesResponse;
  referenceImages: Image[];
}

/** Build a `DesignReference` with `linkMethod: "code-connect"`. */
export function normalizeReference(input: NormalizeInput): DesignReference {
  const tokens = tokensFrom(input.node, input.variables);
  const ref: DesignReference = {
    componentId: input.componentId,
    source: "figma",
    linkMethod: "code-connect",
    ref: input.ref,
    referenceImages: input.referenceImages,
  };
  if (tokens) ref.tokens = tokens;
  return ref;
}
