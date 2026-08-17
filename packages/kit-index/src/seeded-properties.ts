/**
 * Component properties: the kit's *other* kind of variation, and how a code
 * knob reaches one.
 *
 * Not every knob the kit models is an axis. A button's icon, a rail's menu, a
 * sheet's drag handle are COMPONENT PROPERTIES: a switch on the node rather
 * than a variant beside it. That distinction matters twice over.
 *
 * **Reading a miss.** "No counterpart in the kit" is true of a badge's digit
 * count in a way it is not true of a bottom bar's FAB. The FAB is right there —
 * it just is not addressable, because `GET /v1/images` renders a node at its
 * property DEFAULTS and a reference is a node id with nowhere to hang an
 * override. Calling both "absent" hides which ones are an authoring gap and
 * which are a limit of what a reference can express.
 *
 * **Reading a match.** Those defaults are applied whether or not anyone chose
 * them. A set whose `Show icon` defaults to true draws an icon in every render
 * made from it, so a label-only sticker is compared against an icon'd reference
 * and the width divergence that follows is an artefact, not a finding.
 *
 * {@link resolvePropertyInstance} is the way out of the second problem: a
 * visible instance somebody already configured at the wanted vector is a
 * renderable node id for a point in property space no definition can express.
 */
import type {
  KitInstance,
  KitProperty,
  KitPropertyValue,
  KitSet,
  VariantSeed,
} from "./types.js";
import {
  DEFAULT_VOCABULARY,
  FALSY,
  norm,
  sameName,
  singular,
  TRUTHY,
  type Vocabulary,
} from "./vocabulary.js";

/** Words that describe the property rather than name the thing it controls. */
const PROP_FILLER = new Set(["show", "text", "the"]);

/** A property the knob matched, carried with its name so it can be set. */
export interface MatchedProperty {
  name: string;
  type: KitProperty["type"];
  default: KitPropertyValue;
}

/**
 * The kit properties a knob names, or `undefined` when it names none.
 *
 * Returns a LIST rather than a single property, and a tie is not ambiguity to
 * break: one knob genuinely spanning several properties — a count over
 * `Show 1st/2nd/3rd trailing action` — is the finding, and naming one of the
 * three would misreport a family of switches as a single switch.
 */
export function matchProperty(
  properties: Record<string, KitProperty> | undefined,
  knob: string,
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): MatchedProperty[] | undefined {
  const k = singular(norm(knob));
  // The axis vocabulary serves here too: a knob the kit spells as an axis on one
  // component it spells as a property on another — `content` is `Configuration`
  // on a list item and `Show icon` on a button — and one translation table
  // beats two that can disagree.
  const aliased = new Set(
    (vocabulary.axes[knob] ?? []).map((a) => singular(norm(a))),
  );

  let best: { rank: [number, number]; property: MatchedProperty }[] = [];
  for (const [name, def] of Object.entries(properties ?? {})) {
    const meaty = name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !PROP_FILLER.has(t))
      .map(singular);
    // Whole name, then a spelling the vocabulary already knows, then the name
    // minus its filler words, then any single word of it — so `icon` reaches
    // `Show icon` while `Icon (selected)` loses to it.
    const score =
      singular(norm(name)) === k
        ? 0
        : aliased.has(singular(norm(name)))
          ? 1
          : meaty.join("") === k
            ? 2
            : meaty.includes(k)
              ? 3
              : -1;
    if (score < 0) continue;

    const rank: [number, number] = [score, meaty.length];
    const property: MatchedProperty = {
      name,
      type: def.type,
      default: def.default,
    };
    const incumbent = best[0];
    const cmp = incumbent
      ? rank[0] - incumbent.rank[0] || rank[1] - incumbent.rank[1]
      : -1;
    if (cmp < 0) best = [{ rank, property }];
    else if (cmp === 0) best.push({ rank, property });
  }
  return best.length ? best.map((b) => b.property) : undefined;
}

/**
 * The properties a seed names — through its declaration when it carries one, through the alias
 * tables otherwise.
 *
 * A declared name is matched **exactly** (up to case and punctuation), unlike a knob key, whose
 * whole difficulty is that it is not the kit's word. {@link matchProperty}'s partial-word search
 * would accept `kitAxis: "focus"` for `Show focus indicator`, which is the sort of near-miss a
 * declaration exists to rule out: the author is asserting the kit's own name, so a name the set
 * does not publish must find nothing rather than something adjacent.
 */
export function matchSeedProperty(
  properties: Record<string, KitProperty> | undefined,
  seed: VariantSeed,
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): MatchedProperty[] | undefined {
  if (!seed.kitAxis) return matchProperty(properties, seed.key, vocabulary);
  const declared = seed.kitAxis;
  const hits = Object.entries(properties ?? {}).filter(([name]) =>
    sameName(name, declared),
  );
  // Two property names answering to one declaration — `Show icon` beside `Show-icon` — is not a
  // tie to break by declaration order. Setting the wrong one leaves the intended property at its
  // default and returns an instance that renders something nobody asked for.
  const hit = hits.length === 1 ? hits[0] : undefined;
  return hit ? [{ name: hit[0], type: hit[1].type, default: hit[1].default }] : undefined;
}

/**
 * Translate one catalog seed into the value of a kit component property, or
 * `undefined` when the seed has no lossless representation as one.
 *
 * Boolean and text properties have a lossless representation. Instance swaps
 * and slots do not: `leading=icon` says what the content *means*, not which
 * component id supplies it, so those stay unpairable rather than guessing.
 *
 * @param peers the other properties this same seed matched — a count knob
 *   drives a family of ordinal switches together, and a text property's
 *   meaning depends on whether a sibling visibility switch is off.
 */
export function seededPropertyValue(
  property: MatchedProperty,
  seed: VariantSeed,
  peers: MatchedProperty[],
): KitPropertyValue | undefined {
  // A declared kit value is what the kit calls this cell, so it is what the property should be set
  // to: `raw: "hidden"` with `kitValue: "False"` means the switch is off, and translating `hidden`
  // instead would leave the seed unresolved for want of a word no table knows.
  const declared = seed.kitValue;
  const raw = String(declared ?? seed.raw);
  const lower = raw.toLowerCase();

  if (property.type === "BOOLEAN") {
    if (TRUTHY.has(lower)) return true;
    if (FALSY.has(lower)) return false;

    // A numeric count controls the kit's ordinal switches as a family:
    // actions=2 means the first two are on and the third is off.
    const ordinal = /\b(\d+)(?:st|nd|rd|th)\b/i.exec(property.name)?.[1];
    const count = Number(raw);
    if (ordinal && Number.isInteger(count)) return Number(ordinal) <= count;

    const name = norm(property.name);
    if (name.includes("icon")) {
      if (["label", "text", "none"].includes(lower)) return false;
      if (["icon", "both", "icon+label", "label+icon"].includes(lower)) {
        return true;
      }
    }
    return undefined;
  }

  if (property.type === "TEXT") {
    // A DECLARED value is the kit's own word for this cell and goes in verbatim. The reading below
    // is a translation of a code knob — `content=none` meaning "no text here" — and applying it to
    // a declaration would turn a literal `False` or `none` the kit really renders into an empty
    // string, then miss the instance that carries it.
    if (declared !== undefined) return declared;
    // When a sibling visibility property is off, its hidden text stays at the
    // default. A lone text property uses the empty string to express absence.
    if (FALSY.has(lower)) {
      return peers.some((peer) => peer.type === "BOOLEAN")
        ? property.default
        : "";
    }
    return raw;
  }

  if (property.type === "INSTANCE_SWAP") {
    // `content=label` commonly matches both `Show icon` and `Icon`. The
    // instance-swap value is immaterial when the paired visibility switch is
    // off, so retain its default instead of demanding an icon id the catalog
    // seed intentionally does not name.
    const hidden = peers
      .filter((peer) => peer.type === "BOOLEAN")
      .some((peer) => seededPropertyValue(peer, seed, peers) === false);
    return hidden ? property.default : undefined;
  }

  return undefined;
}

const eqValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** What a property-shaped variant resolved to: a node, and the vector it renders at. */
export interface PropertyInstanceHit {
  nodeId: string;
  properties: Record<string, KitPropertyValue>;
}

/**
 * Resolve a property-shaped variant to a visible instance already configured
 * that way in the kit.
 *
 * Pure over the committed index, so false booleans, text values and
 * multi-switch counts can be pinned in tests without a live kit file.
 *
 * The match is on the **whole** property vector — every property the set
 * declares, seeded ones overridden and the rest at their defaults — because a
 * partial match would return an instance that differs in some property nobody
 * asked about, which is the very failure this exists to prevent.
 *
 * @param componentId the variant definition the instance must be *of*. An
 *   instance of a sibling variant carries the right property vector on the
 *   wrong component.
 * @returns `undefined` when any seed has no property representation, when none
 *   of the seeds names a property at all, or when no instance matches. All
 *   three mean "unpaired", which is the honest answer.
 */
export function resolvePropertyInstance(
  set: Pick<KitSet, "properties" | "instances"> | undefined,
  componentId: string,
  seeds: VariantSeed | VariantSeed[],
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): PropertyInstanceHit | undefined {
  if (!set?.properties || !set.instances?.length) return undefined;
  const seedList = Array.isArray(seeds) ? seeds : [seeds];

  const target: Record<string, KitPropertyValue> = Object.fromEntries(
    Object.entries(set.properties).map(([name, def]) => [name, def.default]),
  );

  let claimed = false;
  for (const seed of seedList) {
    // `kitAxis` names the kit's own word for the knob when it has one; a kit is
    // free to model that word as a property rather than as a variant axis.
    const matches = matchSeedProperty(set.properties, seed, vocabulary);
    if (!matches) continue;
    const values = matches.map((property) =>
      seededPropertyValue(property, seed, matches),
    );
    if (values.some((value) => value === undefined)) return undefined;
    matches.forEach((property, i) => {
      target[property.name] = values[i] as KitPropertyValue;
    });
    claimed = true;
  }
  if (!claimed) return undefined;

  const hit = set.instances.find(
    (instance: KitInstance) =>
      instance.componentId === componentId &&
      Object.entries(target).every(([name, value]) =>
        eqValue(instance.properties[name], value),
      ),
  );
  return hit ? { nodeId: hit.id, properties: target } : undefined;
}
