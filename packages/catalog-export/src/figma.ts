/**
 * Figma variables export — the "Figma second" target.
 *
 * The neutral DTCG file (see `dtcg.ts`) is the portable token export; this is
 * the Figma-shaped projection of the same {@link DesignTokens}, ready to create
 * a local **variable collection** (the structure the Figma plugin / REST
 * `POST variables` endpoint consumes). Colours become `COLOR` variables, corner
 * radii and spacing become `FLOAT` variables; typography is left to text styles
 * (Figma has no composite type variable).
 *
 * Light/dark are expressed as Figma **modes**: a colour token keyed
 * `<name>.<mode>` (the suffix `@design-parity/core` uses for themed palettes)
 * contributes its value under that mode; an un-suffixed token applies to every
 * mode. Pure data — the caller serializes or hands it to a writer.
 */
import type { DesignTokens } from "@design-parity/core";

export type FigmaVariableType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

/** One Figma variable: a value per mode id. */
export interface FigmaVariable {
  name: string;
  resolvedType: FigmaVariableType;
  /** Value keyed by mode id; a single `"value"` mode when the token isn't themed. */
  valuesByMode: Record<string, string | number>;
}

/** A Figma variable collection (a design system) with its modes. */
export interface FigmaVariableCollection {
  name: string;
  /** Mode id → human mode name (`"light"`, `"dark"`, or the default `"value"`). */
  modes: Record<string, string>;
  defaultModeId: string;
  variables: FigmaVariable[];
}

/** One named Figma text style projected from a symbolic typography token. */
export interface FigmaTextStyleSpec {
  name: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: string;
  lineHeight?: number;
  letterSpacing?: number;
  /** Native-code expression shown in Dev Mode. */
  androidCodeSyntax: string;
}

/** Preserve typography role names so imports become reusable local text styles. */
export function toFigmaTextStyles(tokens: DesignTokens): FigmaTextStyleSpec[] {
  return Object.entries(tokens.typography ?? {}).map(([name, token]) => ({
    name: `typography/${name}`,
    ...(token.fontFamily !== undefined ? { fontFamily: token.fontFamily } : {}),
    ...(token.fontSize !== undefined ? { fontSize: token.fontSize } : {}),
    ...(token.fontWeight !== undefined ? { fontWeight: token.fontWeight } : {}),
    ...(token.fontStyle !== undefined ? { fontStyle: token.fontStyle } : {}),
    ...(token.lineHeight !== undefined ? { lineHeight: token.lineHeight } : {}),
    ...(token.letterSpacing !== undefined ? { letterSpacing: token.letterSpacing } : {}),
    androidCodeSyntax: `MaterialTheme.typography.${name}`,
  }));
}

const DEFAULT_MODE = "value";

/** Split a `"name.mode"` token key into its base name and optional mode. */
function splitMode(key: string): { name: string; mode?: string } {
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return { name: key };
  const mode = key.slice(dot + 1);
  if (mode === "light" || mode === "dark") return { name: key.slice(0, dot), mode };
  return { name: key };
}

/**
 * Project a {@link DesignTokens} bag onto a {@link FigmaVariableCollection}.
 *
 * @param name collection name (usually the catalog title).
 */
export function toFigmaVariables(
  tokens: DesignTokens,
  name: string,
): FigmaVariableCollection {
  // Discover the modes present across colour keys; default to a single mode.
  const modeIds = new Set<string>();
  for (const key of Object.keys(tokens.colors ?? {})) {
    const { mode } = splitMode(key);
    if (mode) modeIds.add(mode);
  }
  const themed = modeIds.size > 0;
  const modes: Record<string, string> = themed
    ? Object.fromEntries([...modeIds].sort().map((m) => [m, m]))
    : { [DEFAULT_MODE]: "Value" };
  const defaultModeId = themed
    ? (modes["light"] !== undefined ? "light" : [...modeIds].sort()[0]!)
    : DEFAULT_MODE;
  const allModes = Object.keys(modes);

  // Merge themed colour keys (`name.light`, `name.dark`) into one variable.
  const colorVars = new Map<string, FigmaVariable>();
  for (const [key, value] of Object.entries(tokens.colors ?? {})) {
    const { name: base, mode } = splitMode(key);
    let variable = colorVars.get(base);
    if (!variable) {
      variable = { name: `color/${base}`, resolvedType: "COLOR", valuesByMode: {} };
      colorVars.set(base, variable);
    }
    if (mode) {
      variable.valuesByMode[mode] = value;
    } else {
      for (const m of allModes) variable.valuesByMode[m] = value;
    }
  }

  const floatVars: FigmaVariable[] = [];
  const addFloats = (bag: Record<string, number> | undefined, prefix: string): void => {
    for (const [key, value] of Object.entries(bag ?? {})) {
      const valuesByMode: Record<string, number> = {};
      for (const m of allModes) valuesByMode[m] = value;
      floatVars.push({ name: `${prefix}/${key}`, resolvedType: "FLOAT", valuesByMode });
    }
  };
  addFloats(tokens.radius, "radius");
  addFloats(tokens.spacing, "spacing");

  return {
    name,
    modes,
    defaultModeId,
    variables: [...colorVars.values(), ...floatVars],
  };
}
