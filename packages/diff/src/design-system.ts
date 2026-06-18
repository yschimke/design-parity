/**
 * Design-system token-table audit (Phase 3).
 *
 * Where {@link diffTokens} compares a screen's *per-node* tokens, this compares
 * the whole **design-system palette** — the design source's resolved token table
 * ({@link DesignReference.themeTokens}, e.g. the Figma Variables) against the
 * code's resolved theme ({@link SemanticTree.themeTokens}, the compose theme).
 * It runs once per render, keyed through the same code↔design alias as Phase 1,
 * so a palette mismatch (`onSurface` is `#161D1B` in design, `#101413` in code)
 * is reported at the design-system altitude rather than once per screen.
 *
 * v1 audited colours only. It now also audits **typography** (exact, like
 * {@link diffTokens}) and **numeric** system tokens — `radius` (and `spacing`,
 * once the code side exposes a scale) within a committed tolerance. Colours and
 * typography are matched through the explicit alias first, then the Material role
 * a design name denotes (`type/body/large` → `bodyLarge`, `radius/medium` →
 * `medium`), so a real type ramp / shape scale lines up without a hand-written
 * alias for every entry. Colours keep their v1 behaviour unchanged.
 *
 * The design colour table keys colours `<name>.<mode>` (one per Variable mode);
 * the code theme is already resolved to a single theme, so only the entries for
 * the render's `theme` are compared. Numeric/typography tokens carry no mode (a
 * type ramp / shape scale doesn't vary by light/dark), so they compare directly.
 */
import type {
  DesignTokens,
  Finding,
  Theme,
  TokenAliasMap,
  TypographyToken,
} from "@design-parity/core";
import { materialShapeRole, materialTypeRole } from "@design-parity/core";

import { aliasInverse, aliasKey, colorsEqual, typographySatisfies } from "./tokens.js";

export interface DesignSystemOptions {
  /** The render's theme; only design tokens for this mode are audited. */
  theme?: Theme;
  /** Code-name ↔ design-name aliases (the `design-map.json` `tokens` section). */
  alias?: TokenAliasMap;
  /** Max absolute delta (dp) for a spacing token before it's reported. */
  spacingTolerance?: number;
  /** Max absolute delta (dp) for a radius token before it's reported. */
  radiusTolerance?: number;
}

/** Mirrors the engine defaults so a direct caller still gets a sane tolerance. */
const DEFAULT_NUMERIC_TOLERANCE = 1;

/** Split a design colour key `<name>.<mode>` into its base and mode (if any). */
function splitMode(key: string): { base: string; mode?: string } {
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return { base: key };
  return { base: key.slice(0, dot), mode: key.slice(dot + 1).toLowerCase() };
}

/**
 * Compare the design-system palette against the code theme, returning findings
 * tagged `detail.scope: "design-system"` so the orchestrator can report each
 * once across the run. Empty when neither table carries a comparable group.
 */
export function diffDesignSystem(
  designSystem: DesignTokens | undefined,
  codeTheme: DesignTokens | undefined,
  options: DesignSystemOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  diffColors(designSystem?.colors, codeTheme?.colors, options, findings);
  diffNumeric(
    "radius",
    designSystem?.radius,
    codeTheme?.radius,
    options.alias?.radius,
    materialShapeRole,
    options.radiusTolerance ?? DEFAULT_NUMERIC_TOLERANCE,
    findings,
  );
  diffNumeric(
    "spacing",
    designSystem?.spacing,
    codeTheme?.spacing,
    options.alias?.spacing,
    undefined, // Material has no spacing scale — alias / exact name only.
    options.spacingTolerance ?? DEFAULT_NUMERIC_TOLERANCE,
    findings,
  );
  diffTypography(
    designSystem?.typography,
    codeTheme?.typography,
    options.alias?.typography,
    findings,
  );
  return findings;
}

/**
 * The v1 colour audit, unchanged: alias-then-exact name, mode-aware against a
 * single-mode (or itself mode-suffixed) code table.
 */
function diffColors(
  designColors: Record<string, string> | undefined,
  codeColors: Record<string, string> | undefined,
  options: DesignSystemOptions,
  findings: Finding[],
): void {
  if (!designColors || !codeColors) return;
  const toCode = aliasInverse(options.alias?.colors);

  for (const [designKey, designValue] of Object.entries(designColors)) {
    const { base, mode } = splitMode(designKey);
    const codeName = toCode.get(aliasKey(base)) ?? base;

    // Prefer a mode-suffixed code token (a code table that, like the design's,
    // carries every mode). Otherwise the code theme is resolved to one theme, so
    // only the render's mode lines up with the unsuffixed token.
    let codeValue = mode ? codeColors[`${codeName}.${mode}`] : undefined;
    if (codeValue === undefined) {
      if (mode && options.theme && mode !== options.theme) continue;
      codeValue = codeColors[codeName];
    }
    if (codeValue === undefined) continue; // not in the code theme — skip
    if (colorsEqual(designValue, codeValue)) continue;

    findings.push({
      kind: "token",
      severity: "warn",
      message:
        `design-system colors.${codeName}: code ${codeValue} vs design ${designValue}` +
        (mode ? ` (${mode})` : ""),
      detail: {
        scope: "design-system",
        token: `colors.${codeName}`,
        expected: designValue,
        actual: codeValue,
        ...(mode ? { mode } : {}),
      },
    });
  }
}

/**
 * Audit a numeric system scale (radius/spacing) within `tolerance`. Resolves the
 * design name to a code name via the explicit alias, then — where the group has a
 * Material scale (`role`) — the role the name denotes (`radius/medium` →
 * `medium`). A design token with no code counterpart is skipped (it's not in the
 * shipped theme; v1 colour parity does the same).
 */
function diffNumeric(
  group: "radius" | "spacing",
  designTokens: Record<string, number> | undefined,
  codeTokens: Record<string, number> | undefined,
  alias: Record<string, string> | undefined,
  role: ((name: string) => string | undefined) | undefined,
  tolerance: number,
  findings: Finding[],
): void {
  if (!designTokens || !codeTokens) return;
  const toCode = aliasInverse(alias);

  for (const [designKey, designValue] of Object.entries(designTokens)) {
    const codeName = toCode.get(aliasKey(designKey)) ?? role?.(designKey) ?? designKey;
    const codeValue = codeTokens[codeName];
    if (codeValue === undefined) continue;

    const delta = Math.abs(codeValue - designValue);
    if (delta <= tolerance) continue;

    findings.push({
      kind: "token",
      severity: "warn",
      message:
        `design-system ${group}.${codeName}: code ${codeValue} vs design ${designValue} (Δ${round(delta)})`,
      detail: {
        scope: "design-system",
        token: `${group}.${codeName}`,
        expected: designValue,
        actual: codeValue,
        delta: round(delta),
      },
    });
  }
}

/**
 * Audit the type ramp. Like {@link diffTokens}, the match is spec-driven —
 * only the fields the design style declares are compared, so a code style that
 * resolves *more* (e.g. `fontStyle`) isn't drift. Resolves the design style name
 * to a code name via the alias, then the Material type role it denotes
 * (`Body/Large` → `bodyLarge`).
 */
function diffTypography(
  designTypo: Record<string, TypographyToken> | undefined,
  codeTypo: Record<string, TypographyToken> | undefined,
  alias: Record<string, string> | undefined,
  findings: Finding[],
): void {
  if (!designTypo || !codeTypo) return;
  const toCode = aliasInverse(alias);

  for (const [designKey, designValue] of Object.entries(designTypo)) {
    const codeName =
      toCode.get(aliasKey(designKey)) ?? materialTypeRole(designKey) ?? designKey;
    const codeValue = codeTypo[codeName];
    if (codeValue === undefined) continue;
    if (typographySatisfies(designValue, codeValue)) continue;

    findings.push({
      kind: "token",
      severity: "warn",
      message: `design-system typography.${codeName} differs from design`,
      detail: {
        scope: "design-system",
        token: `typography.${codeName}`,
        expected: designValue,
        actual: codeValue,
      },
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
