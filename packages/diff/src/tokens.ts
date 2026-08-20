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
 * The candidate boxes each radius value was declared on, in the radius's own
 * unit.
 *
 * {@link collectTokens} flattens the tree, so by the time a radius reaches the
 * comparison it has lost the node it belonged to — and a corner can only be
 * judged clamped against the box it actually rounds. Handing over the ROOT's
 * bounds instead is what made the first cut of this check inert in the real
 * pipeline: a switch track is 32x20 inside a 137x84 sticker frame, and 16 is
 * nowhere near half of 84, so nothing ever normalised.
 *
 * [boundsDensity] is source pixels per dp for `bounds` — `SemanticTree`'s field
 * of the same name. A tree's `bounds` and its `tokens` need
 * not share a unit: compose/semantics reports boxes in render pixels while
 * resolving radius/padding to dp, so a 52dp button with a 26dp corner arrives as
 * a 104x104 box carrying `corner: 26`. Comparing those directly asks whether 26
 * clears half of 104 — it doesn't — so a fully-clamped corner read as un-clamped
 * and every icon button in a 2x capture reported a Δ against the kit's sentinel.
 * Dividing the boxes through puts both back in dp. Absent (or 1) leaves bounds
 * as they are, which is right for a tree that already reports dp.
 *
 * Keyed by value rather than by node, which is how a spec radius is paired with
 * a candidate one in the first place — see {@link numericValueMatch}.
 */
export function collectRadiusBoxes(
  root: SemanticNode,
  boundsDensity?: number,
): Map<number, Bounds[]> {
  const scale = boundsDensity && boundsDensity > 0 ? boundsDensity : 1;
  const out = new Map<number, Bounds[]>();
  const visit = (node: SemanticNode): void => {
    if (node.bounds) {
      const box =
        scale === 1
          ? node.bounds
          : {
              x: node.bounds.x / scale,
              y: node.bounds.y / scale,
              width: node.bounds.width / scale,
              height: node.bounds.height / scale,
            };
      for (const value of Object.values(node.tokens?.radius ?? {})) {
        out.set(value, [...(out.get(value) ?? []), box]);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

/**
 * The uniform insets the candidate's own geometry *achieves*, in dp — the
 * padding it draws, as opposed to the padding it declares.
 *
 * A reference frame states its inset as an auto-layout `padding`; a candidate
 * often achieves the same picture without one. Wear's `IconButton` is the case
 * that forced this: the kit's cell is a 52x52 frame declaring `padding: 12`
 * around a 26x26 icon, and Compose draws the identical 52dp button by
 * *centring* a 26dp icon with no padding modifier at all. So the candidate
 * reported `padding: 0`, the spec said 12, and every icon button in
 * wear-m3-catalog failed on a difference the render does not contain — while
 * the pixels differed by ~1%.
 *
 * Measuring the drawn inset is what makes the check compare like with like, and
 * it is the same move {@link measuredSpacing} already makes on the Figma side
 * for a frame that declares nothing. It also *keeps* the signal rather than
 * waiving it: a candidate whose icon is the wrong size still misses the spec'd
 * inset, and now says so in the number the designer wrote down.
 *
 * Only a **uniform** inset is reported (all four edges equal within a rounding
 * epsilon). An asymmetric one is a different shape from the scalar `padding`
 * the reference bag carries, and pairing them would compare two things that
 * merely share a name. A zero or negative inset is dropped for the reason
 * `measuredSpacing` drops it: a child that fills or overflows its parent is not
 * evidence of padding.
 *
 * [boundsDensity] converts render pixels to dp — see {@link collectRadiusBoxes}.
 */
export function collectDerivedInsets(
  root: SemanticNode,
  boundsDensity?: number,
  minInset = 1,
): DerivedInset[] {
  const scale = boundsDensity && boundsDensity > 0 ? boundsDensity : 1;
  const out: DerivedInset[] = [];
  const seen = new Set<string>();
  const visit = (node: SemanticNode): void => {
    const box = node.bounds;
    const kids = (node.children ?? []).filter((c) => c.bounds);
    if (box && kids.length > 0) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const k of kids) {
        const b = k.bounds!;
        left = Math.min(left, b.x);
        top = Math.min(top, b.y);
        right = Math.max(right, b.x + b.width);
        bottom = Math.max(bottom, b.y + b.height);
      }
      const edges = [
        left - box.x,
        top - box.y,
        box.x + box.width - right,
        box.y + box.height - bottom,
      ].map((v) => v / scale);
      // Four conditions, stated together because each of the first three was
      // found the hard way, one review round apart, and they only make sense as
      // one invariant: **a measured inset is four positive edges that agree to
      // within the precision of the comparison asking, and that survive being
      // reported.**
      //
      //  1. every edge positive — a child flush against one side has no padding
      //     there, whatever the other three do. `[0.5, 0, 0.5, 0]` is not a
      //     0.5dp inset.
      //  2. they agree within `eps`, which tightens with the caller's floor: the
      //     0.5dp allowance that absorbs px→dp rounding at whole-dp resolution
      //     is *larger than the values themselves* once fractional insets are
      //     admitted, so it cannot stay a constant.
      //  3. at or above [minInset]. Below it a sliver is not a padding — a flush
      //     child measures a fraction of a dp off the conversion, and quoting
      //     "renders 0.5" reads as a measurement. The caller sets this from its
      //     own tolerance, since that is what decides whether a sub-dp value is
      //     meaningful *to this comparison*: a project on the documented strict
      //     `spacingTolerance: 0` may genuinely spec `padding: 0.5`.
      //  4. still positive after rounding, or a value in (0, 0.005) is reported
      //     as `0` — readmitting through the report what (1) rejected at the
      //     measurement.
      const first = edges[0]!;
      const eps = Math.min(UNIFORM_EPSILON, minInset);
      const inset = round2(first);
      const measured =
        edges.every((v) => v > 0) &&
        edges.every((v) => Math.abs(v - first) <= eps) &&
        first >= minInset &&
        inset > 0;
      if (measured) {
        const declaresSpacing = Object.keys(node.tokens?.spacing ?? {}).length > 0;
        const where = node.label ?? node.testTag ?? node.role;
        const key = `${inset}|${declaresSpacing}|${where ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ inset, declaresSpacing, ...(where ? { where } : {}) });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

/** One container's measured inset, kept with enough of its node to be quotable. */
export interface DerivedInset {
  /** The uniform inset its children sit at, in dp. */
  inset: number;
  /**
   * Whether the node declares spacing of its own — i.e. it is a container that
   * has an opinion about padding, and reported (often `0`) rather than being
   * silent. Preferred when choosing which measurement answers a spec, so a
   * nested decorative box does not speak for the component.
   */
  declaresSpacing: boolean;
  /** Label / testTag / role, so a finding can say what it measured. */
  where?: string;
}

/** Sub-dp slack when deciding whether four measured edges are the same inset. */
const UNIFORM_EPSILON = 0.5;

/** Two decimal places — enough for a dp measured back from pixels. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
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

/**
 * Rewrite a token group's keys from design names to code names via the alias,
 * recording the design name each code key came from. The original name is not
 * decoration: it is what says whether a token is an *inset*, and the code
 * vocabulary is free not to say so (`space/inset` → `gutter`).
 */
function remapKeys<T>(
  group: Record<string, T> | undefined,
  alias: Record<string, string> | undefined,
  designNames?: Map<string, string>,
): Record<string, T> | undefined {
  if (!group) return group;
  const inv = aliasInverse(alias);
  if (inv.size === 0) return group;
  const out: Record<string, T> = {};
  for (const [name, value] of Object.entries(group)) {
    const code = inv.get(aliasKey(name)) ?? name;
    out[code] = value;
    if (code !== name) designNames?.set(code, name);
  }
  return out;
}

/**
 * Canonicalise the design-named reference spec to code names via the alias map,
 * so the key-by-key comparison below lines design tokens up with their code
 * counterparts (issue #78). Groups without an alias pass through untouched.
 */
function applyAlias(
  spec: DesignTokens,
  alias: TokenAliasMap,
  designNames: Map<string, string>,
): DesignTokens {
  return {
    spacing: remapKeys(spec.spacing, alias.spacing, designNames),
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
  derivedInsets?: DerivedInset[],
): Finding[] {
  const findings: Finding[] = [];
  if (!specInput) return findings;
  const designNames = new Map<string, string>();
  const spec = alias ? applyAlias(specInput, alias, designNames) : specInput;

  const spacingSpecs = Object.entries(spec.spacing ?? {});
  const spacingFinding = ([name, want]: [string, number]): void =>
    numericFinding(
      "spacing",
      name,
      want,
      candidate.spacing,
      config.spacingTolerance,
      findings,
      undefined,
      derivedInsets,
      designNames.get(name),
    );

  if (unverifiableGroup(spec.spacing, candidate.spacing)) {
    // A candidate that resolved no spacing at all normally can't be judged. But
    // an inset spec CAN be, when the render's own geometry answers it — that is
    // the "declares nothing" case this check exists for, and routing it through
    // the group shortcut made the fallback unreachable in exactly the case it
    // was written for. Only the specs geometry cannot speak to fall back to the
    // group-level advisory.
    const measurable = derivedInsets && derivedInsets.length > 0;
    const insets = measurable
      ? spacingSpecs.filter(([name]) => isInsetToken("spacing", name, designNames.get(name)))
      : [];
    insets.forEach(spacingFinding);
    const rest = spacingSpecs.length - insets.length;
    if (rest > 0) findings.push(groupUnverified("spacing", rest));
  } else {
    spacingSpecs.forEach(spacingFinding);
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
  derivedInsets?: DerivedInset[],
  designName?: string,
): void {
  // Prefer an exact name match; otherwise fall back to a value match. The
  // candidate carries resolved spacing/radius values under generic keys, not the
  // reference's token names (compose-ai-tools#1897), so a spec token is satisfied
  // by any candidate value within tolerance before it's reported missing — the
  // numeric analogue of the colour role-match (issue #74).
  const got = candidate?.[name] ?? numericValueMatch(want, tolerance, candidate);

  // A padding spec the candidate does not *declare* may still be one it *draws*:
  // a reference frame states its inset as auto-layout padding, while the code
  // achieves the same picture by centring its content with no padding modifier
  // (Wear's `IconButton` — see {@link collectDerivedInsets}). Measure what the
  // render actually insets before accusing it, and only for an inset spec: a
  // measured inset is not evidence about a `gap`.
  // ...but only when the declared value actually MISSES. A candidate reporting
  // `0` against a spec of `1` is already inside the tolerance, and overriding
  // that pass with a measured 8 turned a satisfied token into a failure —
  // wear-m3-catalog's `TextToggle` went warn → fail on exactly that. Geometry is
  // a second opinion for a token the declared value cannot answer, never a way
  // to overrule one that already did.
  const declaredMisses = got === undefined || Math.abs(got - want) > tolerance;
  if (
    declaredMisses &&
    (got === undefined || got === 0) &&
    isInsetToken(group, name, designName)
  ) {
    const drawn = nearestInset(want, derivedInsets);
    if (drawn) {
      const delta = round2(Math.abs(drawn.inset - want));
      if (delta <= tolerance) {
        findings.push(satisfiedByGeometry(group, name, want, drawn));
        return;
      }
      // The render insets the WRONG amount. Report that, not the declared `0`:
      // "0 vs spec 12" names a modifier the code was never going to have, while
      // "14 vs spec 12" is the miss a designer can act on.
      findings.push({
        kind: "token",
        severity: "error",
        message: `${group}.${name}: renders ${drawn.inset} vs spec ${want} (Δ${delta})`,
        detail: {
          token: `${group}.${name}`,
          expected: want,
          actual: drawn.inset,
          delta,
          via: "measured-geometry",
          ...(drawn.where ? { measuredOn: drawn.where } : {}),
        },
      });
      return;
    }
  }

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
 * Does this spec token describe an **inset** — the space a container holds
 * around its content? Only those can be answered by a measured inset; a `gap`
 * is the space *between* siblings, and satisfying one with the other would be
 * two different measurements sharing a vocabulary.
 */
function isInsetToken(group: "spacing" | "radius", ...names: Array<string | undefined>): boolean {
  // Checked against every name the token has worn. `applyAlias` rewrites a
  // design key to its code counterpart before the comparison, and the code
  // vocabulary need not contain the word — `space/inset` aliased to `gutter`
  // is still an inset, and classifying on the rewritten name alone would
  // silently switch the geometry check off for exactly the projects that
  // configured an alias.
  return group === "spacing" && names.some((n) => n !== undefined && /padding|inset/i.test(n));
}

/**
 * The measurement that best answers a spec of `want`.
 *
 * A container that declares spacing of its own wins over one that is merely
 * shaped like it: the component reporting `padding: 0` is making a claim about
 * its padding, while a nested centred box is incidental geometry. Without that
 * preference any descendant whose inset happened to land near the spec could
 * speak for the component and demote a real error. Within each tier, nearest
 * to the spec wins.
 */
function nearestInset(want: number, insets: DerivedInset[] | undefined): DerivedInset | undefined {
  if (!insets || insets.length === 0) return undefined;
  const tiers = [insets.filter((i) => i.declaresSpacing), insets];
  for (const tier of tiers) {
    let best: DerivedInset | undefined;
    let bestDelta = Infinity;
    for (const candidate of tier) {
      const delta = Math.abs(candidate.inset - want);
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }
    if (best) return best;
  }
  return undefined;
}

/**
 * The candidate draws the spec'd inset without declaring it. Non-blocking, and
 * *reported* rather than silent: "no padding modifier, but the content sits
 * where the spec puts it" is a real answer to the compliance question, and a
 * reader who sees only a pass cannot tell that the code expresses it
 * differently from the design.
 */
function satisfiedByGeometry(
  group: string,
  name: string,
  want: number,
  drawn: DerivedInset,
): Finding {
  const on = drawn.where ? ` on \`${drawn.where}\`` : "";
  return {
    kind: "token",
    severity: "info",
    message: `${group}.${name}: not declared, but the render insets ${drawn.inset}${on} (spec ${want})`,
    detail: {
      token: `${group}.${name}`,
      expected: want,
      actual: drawn.inset,
      via: "measured-geometry",
      ...(drawn.where ? { measuredOn: drawn.where } : {}),
    },
  };
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
