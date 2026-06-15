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
 * v1 audits colours. The design table keys colours `<name>.<mode>` (one per
 * Variable mode); the code theme is already resolved to a single theme, so only
 * the entries for the render's `theme` are compared.
 */
import type {
  DesignTokens,
  Finding,
  Theme,
  TokenAliasMap,
} from "@design-parity/core";

import { aliasInverse, aliasKey, colorsEqual } from "./tokens.js";

export interface DesignSystemOptions {
  /** The render's theme; only design tokens for this mode are audited. */
  theme?: Theme;
  /** Code-name ↔ design-name aliases (the `design-map.json` `tokens` section). */
  alias?: TokenAliasMap;
}

/** Split a design colour key `<name>.<mode>` into its base and mode (if any). */
function splitMode(key: string): { base: string; mode?: string } {
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return { base: key };
  return { base: key.slice(0, dot), mode: key.slice(dot + 1).toLowerCase() };
}

/**
 * Compare the design-system palette against the code theme, returning findings
 * tagged `detail.scope: "design-system"` so the orchestrator can report each
 * once across the run. Empty when either table (or its colours) is absent.
 */
export function diffDesignSystem(
  designSystem: DesignTokens | undefined,
  codeTheme: DesignTokens | undefined,
  options: DesignSystemOptions = {},
): Finding[] {
  const designColors = designSystem?.colors;
  const codeColors = codeTheme?.colors;
  if (!designColors || !codeColors) return [];

  const toCode = aliasInverse(options.alias?.colors);
  const findings: Finding[] = [];

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
    if (codeValue === undefined) continue; // not in the code theme — skip (v1)
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
  return findings;
}
