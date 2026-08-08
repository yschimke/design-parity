/**
 * Pairing: is this reference a picture of the same thing as this candidate?
 *
 * A rendered reference sits at one point in its component's property space, and
 * the source picks that point from its own defaults (see
 * {@link ReferenceProperty}). When the candidate says it is somewhere else —
 * `Show icon=false` against a reference rendered with `Show icon=true` — the two
 * are not a divergence to measure but a pair that should never have been made.
 * Diffing them produces findings about the wrong thing, and under `design-led`
 * those findings instruct the consumer to change correct code.
 *
 * So the diff reports the pair *unpairable* and leaves it uncompared. Pure — no
 * I/O, no thresholds.
 */
import type { Finding, Image, ReferenceProperty } from "@design-parity/core";

/** One property on which the reference and the candidate disagree. */
export interface PropertyConflict {
  /** Property name as the source spells it. */
  name: string;
  /** What the reference render depicts. */
  reference: string;
  /** What the candidate says it is. */
  candidate: string;
}

/** Compare loosely: sources spell booleans and enum values inconsistently. */
function equivalent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The properties on which a candidate image contradicts the reference.
 *
 * Only properties the candidate *declares* (via {@link Image.props}) are
 * considered: silence is not a claim, so a candidate that says nothing about
 * `Show icon` is not contradicting anything — it is exactly the case the
 * reference's own property list is there to make visible. A reference image may
 * override the reference-wide value with its own `props` (a variant rendered
 * from a different node), and does when it carries one.
 *
 * @returns conflicts in reference-property order; empty when the two agree, or
 *   when neither side declares anything comparable.
 */
export function propertyConflicts(
  properties: readonly ReferenceProperty[] | undefined,
  reference: Image | undefined,
  candidate: Image,
): PropertyConflict[] {
  const claimed = candidate.props;
  if (!claimed || Object.keys(claimed).length === 0) return [];

  const lookup = new Map<string, string>();
  for (const property of properties ?? []) {
    lookup.set(property.name.trim().toLowerCase(), property.value);
  }
  for (const [name, value] of Object.entries(reference?.props ?? {})) {
    lookup.set(name.trim().toLowerCase(), value);
  }

  const conflicts: PropertyConflict[] = [];
  for (const [name, value] of Object.entries(claimed)) {
    const depicted = lookup.get(name.trim().toLowerCase());
    if (depicted === undefined) continue; // the source exposes no such property
    if (equivalent(depicted, value)) continue;
    conflicts.push({ name, reference: depicted, candidate: value });
  }
  return conflicts;
}

function describe(conflicts: readonly PropertyConflict[]): string {
  return conflicts
    .map((c) => `${c.name}=${c.reference} vs ${c.candidate}`)
    .join(", ");
}

/**
 * The finding for a pair left uncompared. `warn`, never `error`: the code is
 * not what is wrong here, and a blocking verdict would say it was.
 */
export function unpairableFinding(
  key: string,
  conflicts: readonly PropertyConflict[],
): Finding {
  return {
    kind: "pairing",
    severity: "warn",
    message:
      `reference variant '${key}' depicts ${describe(conflicts)} — ` +
      `not comparable to the candidate, so it was not diffed`,
    detail: { variant: key, conflicts: conflicts.map((c) => ({ ...c })) },
  };
}

/**
 * What the reference depicts beyond its own name, as an `info` finding.
 *
 * Variant axes are already spelled out in the variant key, so repeating them
 * says nothing. The other property kinds are the silent ones: they change the
 * picture and appear nowhere, which is exactly the surprise that makes a
 * label-only candidate look wrong against an icon+label reference. Stating them
 * is the difference between a diagnosable mismatch and a mysterious one.
 *
 * @returns the finding, or `undefined` when the reference depicts nothing its
 *   name does not already say.
 */
export function depictionFinding(
  properties: readonly ReferenceProperty[] | undefined,
): Finding | undefined {
  const silent = (properties ?? []).filter((p) => p.type !== "variant");
  if (silent.length === 0) return undefined;
  return {
    kind: "pairing",
    severity: "info",
    message:
      `reference renders with ${silent.map((p) => `${p.name}=${p.value}`).join(", ")} ` +
      `— component property defaults the variant name does not state`,
    detail: {
      properties: silent.map((p) => ({ name: p.name, type: p.type, value: p.value })),
    },
  };
}
