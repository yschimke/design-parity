/**
 * Pure mapping from Figma REST structures to a {@link DesignReference}. No I/O —
 * the adapter does the fetching and hands the parsed structures here.
 */
import type {
  DesignReference,
  DesignTokens,
  Image,
  ReferenceProperty,
  TypographyToken,
} from "@design-parity/core";

import type {
  FigmaColor,
  FigmaNodeDoc,
  FigmaStyleMeta,
  VariablesResponse,
} from "./figma-api.js";
import { layoutFromNode } from "./layout.js";
import { hex, solidFill } from "./paint.js";
import { tokenPath } from "./token-name.js";

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

/**
 * A captured length in the **code's** units.
 *
 * Figma reports a board's own pixels and nothing in the file says what they are
 * pixels of, so a 3x board states a 16dp gutter as 48 and 14sp type as 42. The
 * author is the only one who knows the factor; when they have declared it
 * (`DesignMapEntry.density`, reaching here as {@link NormalizeInput.density}),
 * dividing through is what makes a spec comparable to a render that already
 * resolved dp — the whole point of the field (issues #277 / #279).
 *
 * Undefined density leaves the number exactly as captured. That is not a guess
 * at 1x: it is the documented reading of an unstated scale, and it is why this
 * change is inert for every project that has not opted in.
 *
 * Rounded to two places, because a divided-through capture is a measurement,
 * not a spec: `48 / 2.625` is `18.285714…` and quoting that is false precision.
 */
function inCodeUnits(value: number, density: number | undefined): number {
  if (density === undefined || !Number.isFinite(density) || density <= 0) return value;
  return Math.round((value / density) * 100) / 100;
}

function typographyFrom(
  text: FigmaNodeDoc | undefined,
  density?: number,
): TypographyToken | undefined {
  const s = text?.style;
  if (!s) return undefined;
  const token: TypographyToken = {};
  if (s.fontFamily !== undefined) token.fontFamily = s.fontFamily;
  if (s.fontSize !== undefined) token.fontSize = inCodeUnits(s.fontSize, density);
  if (s.fontWeight !== undefined) token.fontWeight = s.fontWeight;
  if (s.lineHeightPx !== undefined) {
    // Rounded whole when unscaled, as it always was; a divided-through capture
    // keeps `inCodeUnits`' two places rather than snapping 47.5px/2.625 to 18.
    token.lineHeight =
      density === undefined
        ? Math.round(s.lineHeightPx)
        : inCodeUnits(s.lineHeightPx, density);
  }
  if (s.letterSpacing !== undefined) token.letterSpacing = inCodeUnits(s.letterSpacing, density);
  return Object.keys(token).length ? token : undefined;
}

function tokensFrom(node: FigmaNodeDoc, density?: number): DesignTokens | undefined {
  const tokens: DesignTokens = {};

  const paddingEdges = [
    ["paddingStart", node.paddingLeft],
    ["paddingTop", node.paddingTop],
    ["paddingEnd", node.paddingRight],
    ["paddingBottom", node.paddingBottom],
  ] as const;
  const declaredPadding = paddingEdges.filter(
    (edge): edge is readonly [typeof edge[0], number] => edge[1] !== undefined,
  );
  if (declaredPadding.length > 0) {
    const first = declaredPadding[0]![1];
    const uniform =
      declaredPadding.length === paddingEdges.length &&
      declaredPadding.every(([, value]) => value === first);
    tokens.spacing = uniform
      ? { padding: inCodeUnits(first, density) }
      : Object.fromEntries(
          declaredPadding.map(([name, value]) => [name, inCodeUnits(value, density)]),
        );
  }

  if (node.cornerRadius !== undefined) {
    tokens.radius = { corner: inCodeUnits(node.cornerRadius, density) };
  }

  // Per-node colours: the frame's own fill and its first text colour. The
  // design-system palette (Variables) lives in `themeTokens`, not here.
  const colors: Record<string, string> = {};
  const container = solidFill(node.fills);
  if (container) colors.container = container;
  const text = firstTextNode(node);
  const label = solidFill(text?.fills);
  if (label) colors.label = label;
  if (Object.keys(colors).length) tokens.colors = colors;

  const typography = typographyFrom(text, density);
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
  density?: number,
): Record<string, TypographyToken> {
  const out: Record<string, TypographyToken> = {};
  if (!styles) return out;
  const visit = (n: FigmaNodeDoc): void => {
    const styleId = n.styles?.text;
    const meta = styleId ? styles[styleId] : undefined;
    if (meta?.styleType === "TEXT") {
      const token = typographyFrom(n, density);
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
  density?: number,
): DesignTokens | undefined {
  const out: DesignTokens = {};
  const colors = colorsFromVariables(variables);
  if (Object.keys(colors).length) out.colors = colors;

  // Variables are deliberately NOT divided through. A published style's
  // properties are read off the board and carry its pixels; a Variable is a
  // number the designer declared, and nothing says it was authored at the
  // board's scale rather than in the system's own units. Scaling it would be
  // the guess this field exists to avoid — so a scaled board's system table
  // stays as the file states it, and only what was measured is converted.
  const numeric = numericFromVariables(variables);
  if (numeric.spacing) out.spacing = numeric.spacing;
  if (numeric.radius) out.radius = numeric.radius;

  const typography = typographyFromStyles(node, styles, density);
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
  /** The component properties the render used — what the reference depicts. */
  properties?: ReferenceProperty[];
  referenceImages: Image[];
  /**
   * Source pixels per dp of this board, from the design map entry — see
   * {@link AdapterContext.density}.
   *
   * Converts every length captured off the artwork into the code's units, and
   * stamps the factor onto the layout so a consumer measuring those boxes knows
   * what they are. Absent means the capture is already in the code's units,
   * which is the documented reading of an unstated scale.
   */
  density?: number;
}

/** Build a `DesignReference` with `linkMethod: "code-connect"`. */
export function normalizeReference(input: NormalizeInput): DesignReference {
  const tokens = tokensFrom(input.node, input.density);
  const themeTokens = themeTokensFrom(
    input.node,
    input.variables,
    input.styles,
    input.density,
  );
  const ref: DesignReference = {
    componentId: input.componentId,
    source: "figma",
    linkMethod: "code-connect",
    ref: input.ref,
    referenceImages: input.referenceImages,
  };
  if (tokens) ref.tokens = tokens;
  if (themeTokens) ref.themeTokens = themeTokens;
  if (input.properties?.length) ref.properties = input.properties;
  // Same `styles` map the type ramp is read from, so a node's annotation names
  // the published style it wears rather than the anonymous `text`.
  const layout = layoutFromNode(input.node, {
    styles: input.styles,
    ...(input.density !== undefined ? { density: input.density } : {}),
  });
  if (layout) ref.layout = layout;
  return ref;
}
