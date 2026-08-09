/**
 * Token collection + token-compliance diff.
 *
 * A {@link DesignReference} carries one flat {@link DesignTokens} bag; a
 * {@link CandidateRender} scatters tokens across its semantic tree. We flatten
 * the candidate's tree into the same shape, then compare key-by-key against the
 * reference spec. Numeric tokens honour a committed tolerance; typography must
 * match exactly on every field the spec declares (the candidate may resolve
 * more — e.g. `fontStyle` / variation axes — without that counting as drift);
 * colours match modulo a full-alpha suffix (`#RRGGBB` ==
 * `#RRGGBBAA`). A spec token the candidate couldn't name falls back to a value
 * match before being reported missing — same-role for colours, within-tolerance
 * for spacing/radius — since the candidate carries resolved values under generic
 * keys rather than the reference's names (compose-ai-tools#1897).
 */
import {
  type DesignTokens,
  type Finding,
  type Bounds,
  type SemanticNode,
  type TokenAliasMap,
  type TypographyToken,
  materialColorRole,
  materialTypeRole,
} from "@design-parity/core";

import type { DiffConfig } from "./config.js";

/**
 * Flatten every node's tokens into one bag, keeping every *distinct* value.
 *
 * A candidate's tree carries one resolved colour/spacing/radius per node, all
 * under the same generic role keys (`bg`/`fg`/`corner`/`gap`) — a plain spread
 * would let each node clobber the last, leaving a single value to match the
 * reference's many named tokens (so a screen with a dozen colours collapses to
 * one `bg` + one `fg`, and everything else falsely reports "missing"). Instead,
 * on a key collision with a *different* value we keep both: the newcomer lands
 * under a derived key (`bg#2`, …) so the value/role matchers below can still find
 * it. Repeats of a value already present (modulo colour alpha) are deduped.
 */
export function collectTokens(root: SemanticNode): DesignTokens {
  const out: DesignTokens = {};
  const visit = (node: SemanticNode): void => {
    mergeInto(out, node.tokens);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

/**
 * The candidate boxes each radius value was declared on.
 *
 * {@link collectTokens} flattens the tree, so by the time a radius reaches the
 * comparison it has lost the node it belonged to — and a corner can only be
 * judged clamped against the box it actually rounds. Handing over the ROOT's
 * bounds instead is what made the first cut of this check inert in the real
 * pipeline: a switch track is 32x20 inside a 137x84 sticker frame, and 16 is
 * nowhere near half of 84, so nothing ever normalised.
 *
 * Keyed by value rather than by node, which is how a spec radius is paired with
 * a candidate one in the first place — see {@link numericValueMatch}.
 */
export function collectRadiusBoxes(root: SemanticNode): Map<number, Bounds[]> {
  const out = new Map<number, Bounds[]>();
  const visit = (node: SemanticNode): void => {
    if (node.bounds) {
      for (const value of Object.values(node.tokens?.radius ?? {})) {
        out.set(value, [...(out.get(value) ?? []), node.bounds]);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

function mergeInto(target: DesignTokens, src?: DesignTokens): void {
  if (!src) return;
  if (src.spacing)
    target.spacing = preserveDistinct(target.spacing, src.spacing, (a, b) => a === b);
  if (src.radius)
    target.radius = preserveDistinct(target.radius, src.radius, (a, b) => a === b);
  if (src.colors)
    target.colors = preserveDistinct(target.colors, src.colors, colorsEqual);
  if (src.typography)
    target.typography = preserveDistinct(target.typography, src.typography, typographyEqual);
}

/** Drop the `#<n>` disambiguation suffix to recover a key's role family. */
function baseKey(key: string): string {
  return key.replace(/#\d+$/, "");
}

/**
 * Merge `src` into `base`, preserving distinct values within each role family.
 * A value equal (per `eq`) to one already present under the same base key is
 * dropped; a genuinely new value for an occupied key is kept under `<key>#<n>`.
 */
function preserveDistinct<T>(
  base: Record<string, T> | undefined,
  src: Record<string, T>,
  eq: (a: T, b: T) => boolean,
): Record<string, T> {
  const out: Record<string, T> = { ...base };
  for (const [key, value] of Object.entries(src)) {
    const family = Object.entries(out).filter(([k]) => baseKey(k) === key);
    if (family.length === 0) {
      out[key] = value;
      continue;
    }
    if (family.some(([, existing]) => eq(existing, value))) continue;
    let n = 2;
    while (`${key}#${n}` in out) n++;
    out[`${key}#${n}`] = value;
  }
  return out;
}

/** Full equality — two tokens are the same value only if every field matches. */
function typographyEqual(a: TypographyToken, b: TypographyToken): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.fontVariationSettings === b.fontVariationSettings &&
    a.fontFeatureSettings === b.fontFeatureSettings &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing
  );
}

/**
 * Does the candidate token [got] satisfy the [spec]? Spec-driven: only the
 * fields the reference actually declares are checked, so a candidate that
 * resolves *more* than the spec asks for (e.g. it now surfaces `fontStyle` /
 * `fontVariationSettings` per compose-ai-tools#1934, which most references don't
 * declare) isn't reported as drift. A field the spec declares but the candidate
 * couldn't resolve (e.g. `fontFamily` fell back) does mismatch — which is the
 * whole point of comparing the resolved face.
 */
export function typographySatisfies(spec: TypographyToken, got: TypographyToken): boolean {
  const fieldOk = <K extends keyof TypographyToken>(key: K): boolean =>
    spec[key] === undefined || spec[key] === got[key];
  return (
    fieldOk("fontFamily") &&
    fieldOk("fontSize") &&
    fieldOk("fontWeight") &&
    fieldOk("fontStyle") &&
    fieldOk("fontVariationSettings") &&
    fieldOk("fontFeatureSettings") &&
    fieldOk("lineHeight") &&
    fieldOk("letterSpacing")
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
  radiusBoxes?: Map<number, Bounds[]>,
): Finding[] {
  const findings: Finding[] = [];
  if (!specInput) return findings;
  const spec = alias ? applyAlias(specInput, alias) : specInput;

  if (unverifiableGroup(spec.spacing, candidate.spacing)) {
    findings.push(groupUnverified("spacing", Object.keys(spec.spacing!).length));
  } else {
    for (const [name, want] of Object.entries(spec.spacing ?? {})) {
      numericFinding("spacing", name, want, candidate.spacing, config.spacingTolerance, findings);
    }
  }
  if (unverifiableGroup(spec.radius, candidate.radius)) {
    findings.push(groupUnverified("radius", Object.keys(spec.radius!).length));
  } else {
    for (const [name, want] of Object.entries(spec.radius ?? {})) {
      numericFinding(
        "radius",
        name,
        want,
        candidate.radius,
        config.radiusTolerance,
        findings,
        radiusBoxes,
      );
    }
  }
  if (unverifiableGroup(spec.colors, candidate.colors)) {
    findings.push(groupUnverified("colors", Object.keys(spec.colors!).length));
  } else
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
  if (unverifiableGroup(spec.typography, candidate.typography)) {
    findings.push(groupUnverified("typography", Object.keys(spec.typography!).length));
    return findings;
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
    } else if (!typographySatisfies(want, got)) {
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
  radiusBoxes?: Map<number, Bounds[]>,
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
  // A radius at or past half the shorter side draws a stadium: the corner is
  // clamped, and every larger number draws the same pixels. Design systems say
  // "fully rounded" with a sentinel (Material's kit uses 100) while code says it
  // with whatever number cleared the clamp, so comparing the two as lengths
  // reports a Δ96 between two identical shapes. When BOTH sides are past the
  // clamp they describe the same corner, whatever they call it.
  const boxes = group === "radius" ? radiusBoxes?.get(got) : undefined;
  if (boxes && isPill(got, boxes) && isPill(want, boxes)) return;

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

/**
 * Whether `radius` is at or past the clamp for a box of this size — the point
 * beyond which the corner cannot get any rounder.
 *
 * Deliberately symmetric and unit-agnostic: it does not need to know whether a
 * spec's `100` means dp or per cent, because either reading is past the clamp on
 * any box small enough for the question to arise.
 */
function isPill(radius: number, boxes: Bounds[]): boolean {
  return boxes.some((b) => {
    const shorter = Math.min(b.width, b.height);
    return shorter > 0 && radius >= shorter / 2;
  });
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

/**
 * Which "ground" a colour role paints on: `fg` (text/icon — `onPrimary`, `fg`),
 * `bg` (a fill — `surface`, `bg`, a container), or `any` for an M3 **accent**
 * base role (`primary`/`secondary`/`tertiary`/`error`) used both as a fill *and*
 * as accent text/icon, so it may legitimately surface under either ground.
 */
function colorGround(name: string): "fg" | "bg" | "any" {
  if (baseKey(name) === "fg" || /^on[A-Z]/.test(name)) return "fg";
  if (/^(primary|secondary|tertiary|error)$/i.test(baseKey(name))) return "any";
  return "bg";
}

/**
 * Find a candidate colour matching `want` under the same ground as the spec
 * token `name`. The candidate's per-node colours collapse onto generic role
 * keys (`fg`/`bg`) when its theme can't name them, so a foreground spec token is
 * satisfied by any foreground candidate value of the same colour (and a
 * background token likewise); an accent base role matches either. Returns the
 * matching value, or `undefined`.
 */
function roleMatch(
  name: string,
  want: string,
  candidate?: Record<string, string>,
): string | undefined {
  if (!candidate) return undefined;
  const wantGround = colorGround(name);
  for (const [key, value] of Object.entries(candidate)) {
    const candGround = colorGround(key);
    const groundsAgree =
      wantGround === "any" || candGround === "any" || candGround === wantGround;
    if (groundsAgree && colorsEqual(value, want)) return value;
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

/**
 * A group the spec declares but the candidate resolved *nothing* for (e.g. a
 * geometry-only capture surfaces no colours or radii at all). Comparing the
 * spec's whole palette against an empty candidate group turns every token into
 * an identical `missing` hard error — dozens of findings that say nothing beyond
 * "the candidate reported no <group>", and drag the verdict to a fail on what is
 * an *extraction gap*, not evidence the candidate's values are wrong. This is the
 * group-level analogue of {@link advisory} (issue #102): when there's nothing to
 * line the spec up against, we can't verify — we don't accuse.
 */
function unverifiableGroup(
  spec: Record<string, unknown> | undefined,
  candidate: Record<string, unknown> | undefined,
): boolean {
  const specHas = spec !== undefined && Object.keys(spec).length > 0;
  const candHas = candidate !== undefined && Object.keys(candidate).length > 0;
  return specHas && !candHas;
}

/** One non-blocking note standing in for a whole unverifiable token group. */
function groupUnverified(group: string, specCount: number): Finding {
  const tokens = `${specCount} spec token${specCount === 1 ? "" : "s"}`;
  return {
    kind: "token",
    severity: "info",
    message: `${group}: candidate resolved no ${group} tokens; compliance not evaluated (${tokens})`,
    detail: { token: `${group}.*`, expected: null, actual: null, unverified: true, specCount },
  };
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
