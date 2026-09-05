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
 * mode. A system's **alternate themes** (`CatalogManifest.themes`) each add one
 * further mode, so the design system arrives in Figma as one collection a
 * designer switches rather than N disconnected imports. Pure data — the caller
 * serializes or hands it to a writer.
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
 * One alternate theme contributing a mode, resolved from `CatalogManifest.themes`.
 *
 * A theme is **one mode**, not a light/dark pair, because the catalog model
 * already treats them that way: a provider list enumerates each palette
 * separately and flags which are dark (Pocket Casts' LIGHT / DARK / EXTRA_DARK /
 * ELECTRIC are four themes, not two). Where a theme's own token file still
 * carries `.light` / `.dark` suffixes, {@link dark} picks the arm.
 */
export interface FigmaThemeTokens {
  /** Stable mode id — the theme's manifest id (the provider FQN). */
  id: string;
  /** Human mode name; falls back to the id's last dot-segment. */
  name?: string;
  /** Which suffixed arm to read out of this theme's own token file. */
  dark?: boolean;
  tokens: DesignTokens;
}

/** The label a mode carries when the theme declares none. */
function themeModeName(theme: FigmaThemeTokens): string {
  if (theme.name !== undefined && theme.name !== "") return theme.name;
  const tail = theme.id.split(".").pop();
  return tail !== undefined && tail !== "" ? tail : theme.id;
}

/**
 * Read one value out of a theme's token bag for a given base name.
 *
 * Prefers the arm matching the theme's own light/dark stance, then the
 * un-suffixed key, and gives up rather than guessing the other arm — a dark
 * theme showing its light palette is worse than a dark theme falling back to
 * the system value, which is what {@link toFigmaVariables} then does.
 */
function themeValue(
  bag: Record<string, string> | undefined,
  base: string,
  dark: boolean | undefined,
): string | undefined {
  const arm = dark === true ? "dark" : "light";
  return bag?.[`${base}.${arm}`] ?? bag?.[base];
}

/**
 * Project a {@link DesignTokens} bag onto a {@link FigmaVariableCollection}.
 *
 * @param name collection name (usually the catalog title).
 * @param themes alternate themes, each becoming one further mode. Omitting them
 *   (or passing none) produces exactly the collection this returned before
 *   themes existed — the field is additive, and a catalog that declares none
 *   must not import differently because the parameter now exists.
 */
export function toFigmaVariables(
  tokens: DesignTokens,
  name: string,
  themes: readonly FigmaThemeTokens[] = [],
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
  // The modes the SYSTEM tokens fill. Alternate themes get their own mode each
  // and must not be swept up by the "un-suffixed token applies to every mode"
  // rule below — that rule is about light/dark arms of one palette, and
  // applying it across themes would paint every theme with the system's colour
  // and then report success.
  const systemModes = Object.keys(modes);
  // Two themes are allowed to share an id only in the sense that the second
  // would silently overwrite the first, so drop the duplicate rather than
  // producing a collection whose mode count disagrees with the theme list.
  const seenThemes = new Set<string>(systemModes);
  const usableThemes = themes.filter((theme) => {
    if (theme.id === "" || seenThemes.has(theme.id)) return false;
    seenThemes.add(theme.id);
    return true;
  });
  for (const theme of usableThemes) modes[theme.id] = themeModeName(theme);
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
      for (const m of systemModes) variable.valuesByMode[m] = value;
    }
  }

  // Each theme fills its own mode, for the variables the system already
  // declares. A theme that introduces a colour the system does not have gets a
  // variable of its own, left to the fill pass for every other mode — the
  // alternative, dropping it, loses the one thing an alternate palette is for.
  for (const theme of usableThemes) {
    for (const base of new Set([
      ...colorVars.keys(),
      ...Object.keys(theme.tokens.colors ?? {}).map((key) => splitMode(key).name),
    ])) {
      const value = themeValue(theme.tokens.colors, base, theme.dark);
      if (value === undefined) continue;
      let variable = colorVars.get(base);
      if (!variable) {
        variable = { name: `color/${base}`, resolvedType: "COLOR", valuesByMode: {} };
        colorVars.set(base, variable);
      }
      variable.valuesByMode[theme.id] = value;
    }
  }

  const floatVars = new Map<string, FigmaVariable>();
  const addFloats = (
    bag: Record<string, number> | undefined,
    prefix: string,
    intoModes: readonly string[],
  ): void => {
    for (const [key, value] of Object.entries(bag ?? {})) {
      const name = `${prefix}/${key}`;
      let variable = floatVars.get(name);
      if (!variable) {
        variable = { name, resolvedType: "FLOAT", valuesByMode: {} };
        floatVars.set(name, variable);
      }
      for (const m of intoModes) variable.valuesByMode[m] = value;
    }
  };
  addFloats(tokens.radius, "radius", systemModes);
  addFloats(tokens.spacing, "spacing", systemModes);
  for (const theme of usableThemes) {
    addFloats(theme.tokens.radius, "radius", [theme.id]);
    addFloats(theme.tokens.spacing, "spacing", [theme.id]);
  }

  const variables = [...colorVars.values(), ...floatVars.values()];

  // Figma needs a value for every mode of every variable in the collection: a
  // hole is not "inherit", it is a variable the mode cannot resolve. Fill from
  // the default mode, then from whatever the variable does define, so a theme
  // that only restates part of the palette inherits the rest instead of
  // importing a collection Figma rejects.
  for (const variable of variables) {
    const fallback =
      variable.valuesByMode[defaultModeId] ?? Object.values(variable.valuesByMode)[0];
    if (fallback === undefined) continue;
    for (const m of allModes) {
      if (variable.valuesByMode[m] === undefined) variable.valuesByMode[m] = fallback;
    }
  }

  return { name, modes, defaultModeId, variables };
}
