/**
 * A **slim, browser-safe** DTCG token reader.
 *
 * The Figma UI runs in an iframe with no filesystem, so it can't use
 * `@design-parity/core`'s {@link readDtcgTokens} — that pulls the on-disk JSON
 * schema (a `node:fs` dependency) into the bundle. This reader takes an
 * already-parsed DTCG document (the UI `fetch`ed the JSON) and pulls out just
 * what {@link toFigmaVariables} consumes: the `color`, `radius`, and `spacing`
 * groups. It mirrors the shape `@design-parity/core`'s `tokensToDtcg` writes —
 * one top-level group per category, child keys taken verbatim (so a themed
 * colour key like `surface.light` keeps the dot suffix `toFigmaVariables`
 * splits modes on).
 *
 * It is deliberately not the validated reader: no `$schema` check, no alias
 * (`{alias}`) resolution, no typography. For the catalog-import prototype the
 * catalog's own `tokens.dtcg.json` is trusted input; the authoritative,
 * schema-validating reader remains core's `readDtcgTokens` (Node only).
 */
import type { CatalogManifestTheme } from "@design-parity/catalog-export";
import type { FigmaThemeTokens } from "@design-parity/catalog-export/figma";
import type { DesignTokens } from "@design-parity/core";

interface DtcgNode {
  $value?: unknown;
  [key: string]: unknown;
}

function isObject(value: unknown): value is DtcgNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A DTCG dimension `$value` is a number, a numeric string, or `{ value, unit }`. */
function readDimension(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (isObject(value) && typeof value["value"] === "number") return value["value"];
  return undefined;
}

function readColor(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Pull the immediate `$value` children of a DTCG group into a flat bag. */
function readGroup<T>(
  group: unknown,
  read: (value: unknown) => T | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObject(group)) return out;
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith("$")) continue;
    if (!isObject(node) || !("$value" in node)) continue;
    const value = read(node.$value);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Read a parsed DTCG document into the {@link DesignTokens} bag (browser-safe). */
export function readDtcgTokensLite(doc: unknown): DesignTokens {
  const tokens: DesignTokens = {};
  if (!isObject(doc)) return tokens;

  const colors = readGroup(doc["color"], readColor);
  if (Object.keys(colors).length > 0) tokens.colors = colors;

  const radius = readGroup(doc["radius"], readDimension);
  if (Object.keys(radius).length > 0) tokens.radius = radius;

  const spacing = readGroup(doc["spacing"], readDimension);
  if (Object.keys(spacing).length > 0) tokens.spacing = spacing;

  return tokens;
}

/**
 * Resolve `CatalogManifest.themes` into the projection's {@link FigmaThemeTokens}.
 *
 * The manifest carries each alternate theme's tokens as a **sibling file**
 * rather than inline, so this needs a reader: `readJson` fetches over the base
 * URL for a published catalog, or reads out of the picked directory for a local
 * one. Both load paths share this function so they cannot resolve themes
 * differently.
 *
 * A theme whose file will not read is **skipped, not fatal**. The catalog's
 * renders are the import's point and they are already in hand; failing the
 * whole import over one missing palette would trade the thing the designer
 * asked for against a mode they may not have noticed. The caller reports how
 * many resolved so a short count is visible rather than silent.
 */
export async function resolveThemeTokens(
  themes: readonly CatalogManifestTheme[] | undefined,
  readJson: (path: string) => Promise<unknown | undefined>,
): Promise<FigmaThemeTokens[]> {
  const resolved: FigmaThemeTokens[] = [];
  for (const theme of themes ?? []) {
    if (!theme?.id || !theme.tokensFile) continue;
    let doc: unknown | undefined;
    try {
      doc = await readJson(theme.tokensFile);
    } catch {
      continue;
    }
    if (doc === undefined) continue;
    resolved.push({
      id: theme.id,
      ...(theme.name !== undefined ? { name: theme.name } : {}),
      ...(theme.dark !== undefined ? { dark: theme.dark } : {}),
      tokens: readDtcgTokensLite(doc),
    });
  }
  return resolved;
}
