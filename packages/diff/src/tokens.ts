/**
 * Token collection + token-compliance diff.
 *
 * A {@link DesignReference} carries one flat {@link DesignTokens} bag; a
 * {@link CandidateRender} scatters tokens across its semantic tree. We flatten
 * the candidate's tree into the same shape, then compare key-by-key against the
 * reference spec. Numeric tokens honour a committed tolerance; typography must
 * match exactly; colours match modulo a full-alpha suffix (`#RRGGBB` ==
 * `#RRGGBBAA`). A spec token the candidate couldn't name falls back to a value
 * match before being reported missing — same-role for colours, within-tolerance
 * for spacing/radius — since the candidate carries resolved values under generic
 * keys rather than the reference's names (compose-ai-tools#1897).
 */
import {
  type DesignTokens,
  type Finding,
  type SemanticNode,
  type TokenAliasMap,
  type TypographyToken,
  materialColorRole,
  materialTypeRole,
} from "@design-parity/core";

import type { DiffConfig } from "./config.js";

/** Deep-merge every node's tokens into one flat bag (children override parents). */
export function collectTokens(root: SemanticNode): DesignTokens {
  const out: DesignTokens = {};
  const visit = (node: SemanticNode): void => {
    mergeInto(out, node.tokens);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

function mergeInto(target: DesignTokens, src?: DesignTokens): void {
  if (!src) return;
  if (src.spacing) target.spacing = { ...target.spacing, ...src.spacing };
  if (src.radius) target.radius = { ...target.radius, ...src.radius };
  if (src.colors) target.colors = { ...target.colors, ...src.colors };
  if (src.typography)
    target.typography = { ...target.typography, ...src.typography };
}

function typographyEqual(a: TypographyToken, b: TypographyToken): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing
  );
}

/** Fold a token name to an alias-lookup key: last `/`-segment, lowercased. */
export function aliasKey(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1).toLowerCase();
}

/** Invert a code→design alias group into a design-key → code-name index. */
export function aliasInverse(group?: Record<string, string>): Map<string, string> {
  const inv = new Map<string, string>();
  for (const [code, design] of Object.entries(group ?? {})) {
    const key = aliasKey(design);
    if (!inv.has(key)) inv.set(key, code); // first declaration wins, deterministically
  }
  return inv;
}

/** Rewrite a token group's keys from design names to code names via the alias. */
function remapKeys<T>(
  group: Record<string, T> | undefined,
  alias?: Record<string, string>,
): Record<string, T> | undefined {
  if (!group) return group;
  const inv = aliasInverse(alias);
  if (inv.size === 0) return group;
  const out: Record<string, T> = {};
  for (const [name, value] of Object.entries(group)) {
    out[inv.get(aliasKey(name)) ?? name] = value;
  }
  return out;
}

/**
 * Canonicalise the design-named reference spec to code names via the alias map,
 * so the key-by-key comparison below lines design tokens up with their code
 * counterparts (issue #78). Groups without an alias pass through untouched.
 */
function applyAlias(spec: DesignTokens, alias: TokenAliasMap): DesignTokens {
  return {
    spacing: remapKeys(spec.spacing, alias.spacing),
    radius: remapKeys(spec.radius, alias.radius),
    colors: remapKeys(spec.colors, alias.colors),
    typography: remapKeys(spec.typography, alias.typography),
  };
}

/**
 * Compare candidate tokens against the reference spec. Findings are emitted in
 * a stable order — spacing, radius, colours, typography — so the verdict is
 * reproducible. A reference token absent from the candidate is a `missing`
 * finding; tokens the candidate adds beyond the spec are ignored.
 *
 * When a {@link TokenAliasMap} is supplied, the design-named spec is first
 * canonicalised to code names so differing vocabularies still match.
 */
export function diffTokens(
  specInput: DesignTokens | undefined,
  candidate: DesignTokens,
  config: DiffConfig,
  alias?: TokenAliasMap,
): Finding[] {
  const findings: Finding[] = [];
  if (!specInput) return findings;
  const spec = alias ? applyAlias(specInput, alias) : specInput;

  for (const [name, want] of Object.entries(spec.spacing ?? {})) {
    numericFinding("spacing", name, want, candidate.spacing, config.spacingTolerance, findings);
  }
  for (const [name, want] of Object.entries(spec.radius ?? {})) {
    numericFinding("radius", name, want, candidate.radius, config.radiusTolerance, findings);
  }
  for (const [name, want] of Object.entries(spec.colors ?? {})) {
    // Match a spec colour against the candidate in three tiers, most precise
    // first. (1) Exact name — the explicit alias map has already canonicalised
    // design names to code names (issue #78). (2) Material colour role — a
    // reference token *named in design-system vocabulary* (`color/on-surface`)
    // is recognised as the role it denotes (`onSurface`) and matched against the
    // candidate's resolved role (compose-ai-tools#1897, issue #87); a low-
    // confidence name match, so a mismatch is flagged `via: "role-heuristic"`.
    // (3) Value match under the same generic role key (`fg`/`bg`) for an
    // unresolved theme (issue #74).
    const role = materialColorRole(name);
    const byRole = role !== undefined ? candidate.colors?.[role] : undefined;
    const got =
      candidate.colors?.[name] ?? byRole ?? roleMatch(name, want, candidate.colors);
    if (got === undefined) {
      // A spec token that maps to a Material role the candidate genuinely lacks
      // is a real gap (hard error). One that maps to *no* role and didn't value-
      // match is something we couldn't verify, not proof the candidate is wrong —
      // report it as a non-blocking advisory rather than a false mismatch
      // (issue #102 / #87).
      findings.push(
        role !== undefined
          ? missing("colors", name, want)
          : advisory("colors", name, want),
      );
    } else if (!colorsEqual(got, want)) {
      const viaRole = candidate.colors?.[name] === undefined && byRole === got;
      findings.push({
        kind: "token",
        severity: "warn",
        message: `colors.${name}: ${got} vs spec ${want}`,
        detail: {
          token: `colors.${name}`,
          expected: want,
          actual: got,
          ...(viaRole ? { role, via: "role-heuristic" } : {}),
        },
      });
    }
  }
  for (const [name, want] of Object.entries(spec.typography ?? {})) {
    // Exact name first, then the Material type-scale role a design-vocabulary
    // name denotes (`type/body/large` → `bodyLarge`) — the typography analogue
    // of the colour role heuristic (issue #87).
    const role = materialTypeRole(name);
    const got =
      candidate.typography?.[name] ??
      (role !== undefined ? candidate.typography?.[role] : undefined);
    if (got === undefined) {
      // Same rule as colours (#102): mapped-to-a-role-but-absent is a hard
      // error; unmappable is an advisory, not a false mismatch.
      findings.push(
        role !== undefined
          ? missing("typography", name, JSON.stringify(want))
          : advisory("typography", name, JSON.stringify(want)),
      );
    } else if (!typographyEqual(want, got)) {
      findings.push({
        kind: "token",
        severity: "warn",
        message: `typography.${name} differs from spec`,
        detail: { token: `typography.${name}`, expected: want, actual: got },
      });
    }
  }
  return findings;
}

function numericFinding(
  group: "spacing" | "radius",
  name: string,
  want: number,
  candidate: Record<string, number> | undefined,
  tolerance: number,
  findings: Finding[],
): void {
  // Prefer an exact name match; otherwise fall back to a value match. The
  // candidate carries resolved spacing/radius values under generic keys, not the
  // reference's token names (compose-ai-tools#1897), so a spec token is satisfied
  // by any candidate value within tolerance before it's reported missing — the
  // numeric analogue of the colour role-match (issue #74).
  const got = candidate?.[name] ?? numericValueMatch(want, tolerance, candidate);
  if (got === undefined) {
    findings.push(missing(group, name, String(want)));
    return;
  }
  const delta = Math.abs(got - want);
  if (delta > tolerance) {
    findings.push({
      kind: "token",
      severity: "error",
      message: `${group}.${name}: ${got} vs spec ${want} (Δ${delta})`,
      detail: { token: `${group}.${name}`, expected: want, actual: got, delta },
    });
  }
}

/** The candidate value closest to `want` within `tolerance`, or `undefined`. */
function numericValueMatch(
  want: number,
  tolerance: number,
  candidate: Record<string, number> | undefined,
): number | undefined {
  if (!candidate) return undefined;
  let best: number | undefined;
  let bestDelta = Infinity;
  for (const value of Object.values(candidate)) {
    const delta = Math.abs(value - want);
    if (delta <= tolerance && delta < bestDelta) {
      best = value;
      bestDelta = delta;
    }
  }
  return best;
}

/** A token name carries a foreground (text/icon) colour: `onPrimary`, `fg`. */
function isForegroundToken(name: string): boolean {
  return name === "fg" || /^on[A-Z]/.test(name);
}

/**
 * Find a candidate colour matching `want` under the same role as the spec
 * token `name`. The candidate's per-node colours collapse onto generic role
 * keys (`fg`/`bg`) when its theme can't name them, so a foreground spec token
 * is satisfied by any foreground candidate value of the same colour (and a
 * background token likewise). Returns the matching value, or `undefined`.
 */
function roleMatch(
  name: string,
  want: string,
  candidate?: Record<string, string>,
): string | undefined {
  if (!candidate) return undefined;
  const wantForeground = isForegroundToken(name);
  for (const [key, value] of Object.entries(candidate)) {
    if (isForegroundToken(key) === wantForeground && colorsEqual(value, want)) {
      return value;
    }
  }
  return undefined;
}

/** Split a hex colour into lowercase `rgb` + `alpha`, or `undefined` if not hex. */
function parseHexColor(value: string): { rgb: string; alpha: string } | undefined {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  // Candidate values are `#RRGGBBAA` (alpha last, from `argbToCssHex`); the
  // reference spec is typically `#RRGGBB`. Treat a 6-digit value as opaque.
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return { rgb: hex.toLowerCase(), alpha: "ff" };
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return { rgb: hex.slice(0, 6).toLowerCase(), alpha: hex.slice(6, 8).toLowerCase() };
  }
  return undefined;
}

/** Compare two colours, treating `#RRGGBB` and full-alpha `#RRGGBBAA` as equal. */
export function colorsEqual(a: string, b: string): boolean {
  const pa = parseHexColor(a);
  const pb = parseHexColor(b);
  if (!pa || !pb) return a.toLowerCase() === b.toLowerCase();
  return pa.rgb === pb.rgb && pa.alpha === pb.alpha;
}

function missing(group: string, name: string, want: string): Finding {
  return {
    kind: "token",
    severity: "error",
    message: `${group}.${name} missing from candidate (spec ${want})`,
    detail: { token: `${group}.${name}`, expected: want, actual: null },
  };
}

/**
 * A spec token that maps to no Material role and didn't value-match: we can't
 * line it up with anything the candidate resolved, so we can't verify it.
 * Non-blocking `info` (never escalates the verdict) — reported, not a false
 * `missing` error (issue #102). Numerics stay strict and never come here.
 */
function advisory(group: string, name: string, want: string): Finding {
  return {
    kind: "token",
    severity: "info",
    message: `${group}.${name} has no Material-role mapping; unverified (spec ${want})`,
    detail: { token: `${group}.${name}`, expected: want, actual: null, unmapped: true },
  };
}
