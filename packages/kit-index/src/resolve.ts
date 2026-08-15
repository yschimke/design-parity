/**
 * Resolve a catalog variant to the kit node that documents it.
 *
 * A component's reference is a variant node whose NAME is an axis vector —
 * `Type=Round, Size=Small, State=Enabled`. Every seed is projected onto that
 * vector, and the exact final combination must name a real sibling in the same
 * component set. This handles both a single axis (`size=l`) and a rendered
 * cross-product cell (`size=l, shape=square`) without ever inventing a
 * combination the kit does not publish.
 *
 * The governing rule throughout: **a wrong translation must find nothing rather
 * than produce a confident bad reference.** Under a `design-led` direction a
 * bad reference drives the code away from the kit it is copying, and it does so
 * while reporting a clean parity result — the worst available outcome. Every
 * unresolved seed is therefore surfaced as unresolved.
 */
import { parseVariantName } from "@design-parity/adapter-figma";

import {
  matchProperty,
  resolvePropertyInstance,
  type MatchedProperty,
} from "./seeded-properties.js";
import type {
  KitIndex,
  KitProperty,
  KitSet,
  ResolvedVariant,
  VariantSeed,
} from "./types.js";
import {
  axisCandidates,
  FALSY,
  mergeVocabulary,
  norm,
  TRUTHY,
  valueCandidates,
  wordsOf,
  type Vocabulary,
} from "./vocabulary.js";

/** A variant node with its axes parsed and its owning set remembered. */
interface IndexedVariant {
  setId: string;
  setName: string;
  name: string;
  axes: Record<string, string>;
  renderId?: string;
}

/** A standalone component, for kits that model families as folder siblings. */
interface IndexedStandalone {
  id: string;
  name: string;
}

/** What a knob turned out to be, when the kit models it as a property. */
export interface SeedProperty {
  setName: string;
  properties: MatchedProperty[];
  /**
   * The property's default already equals what this variant seeds — so the
   * reference draws the VARIANT, and it is the base pair beside it that depicts
   * something its own render never claimed.
   */
  coversVariant: boolean;
}

/** Optional content a set switches on by default, whatever the code drew. */
export interface DefaultedContent {
  name: string;
  setName: string;
}

/** Which design-map slot a knob fills: the schema tags refs by state/size/theme. */
const SIZE_KNOBS = new Set(["size", "shape"]);

/** `size` for a size/shape knob, `state` for everything else. */
export function slotFor(
  seedOrSeeds: VariantSeed | VariantSeed[],
  variantName: string,
): { size: string } | { state: string } {
  const seeds = Array.isArray(seedOrSeeds) ? seedOrSeeds : [seedOrSeeds];
  const only = seeds.length === 1 ? seeds[0] : undefined;
  return only && SIZE_KNOBS.has(only.key)
    ? { size: String(only.raw) }
    : { state: variantName };
}

export interface KitIndexResolverOptions {
  /** Per-kit overrides merged over the built-in translation tables. */
  vocabulary?: Partial<Vocabulary>;
}

/**
 * A loaded kit index, ready to answer questions about it.
 *
 * Constructed from the index **object** rather than a path: the index is a
 * committed artifact a caller has already read (and may have got from a
 * bundle, a cache, or a test fixture), and a resolver that reads a fixed
 * filename from the working directory cannot be used twice in one process or
 * tested without a real kit.
 */
export class KitIndexResolver {
  readonly #index: KitIndex;
  readonly #vocabulary: Vocabulary;
  readonly #variants = new Map<string, IndexedVariant>();
  readonly #sets = new Map<string, KitSet & { id: string }>();
  readonly #standalone: IndexedStandalone[];
  readonly #standaloneById = new Map<string, IndexedStandalone>();

  constructor(index: KitIndex, opts: KitIndexResolverOptions = {}) {
    this.#index = index;
    this.#vocabulary = mergeVocabulary(opts.vocabulary);

    for (const [setId, set] of Object.entries(index.sets)) {
      this.#sets.set(setId, { ...set, id: setId });
      for (const variant of set.variants) {
        this.#variants.set(variant.id, {
          setId,
          setName: set.name,
          name: variant.name,
          axes: Object.fromEntries(parseVariantName(variant.name)),
          ...(variant.renderId ? { renderId: variant.renderId } : {}),
        });
      }
    }

    this.#standalone = Object.entries(index.standalone).map(([id, c]) => ({
      id,
      name: c.name,
    }));
    for (const component of this.#standalone) {
      this.#standaloneById.set(component.id, component);
    }
  }

  /** The file every node id in this index is addressed within. */
  get fileKey(): string {
    return this.#index.fileKey;
  }

  /**
   * Accept either a `figma:<fileKey>/<nodeId>` ref or a bare node id.
   *
   * A ref naming a *different* file resolves to nothing rather than to whatever
   * node happens to share that id here — node ids are only unique per file, so
   * ignoring the file key would silently answer about the wrong document.
   */
  #nodeIdOf(refOrNodeId: string): string | undefined {
    if (!refOrNodeId.startsWith("figma:")) return refOrNodeId;
    const rest = refOrNodeId.slice("figma:".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return undefined;
    // Node ids contain a colon, never a slash — so the FIRST slash ends the key.
    if (rest.slice(0, slash) !== this.#index.fileKey) return undefined;
    return rest.slice(slash + 1);
  }

  /** Re-attach the `figma:<fileKey>/` scheme to a resolved node id. */
  #refOf(nodeId: string): string {
    return `figma:${this.#index.fileKey}/${nodeId}`;
  }

  /** The set a reference points into, when it points at one of its variants. */
  #setForRef(refOrNodeId: string):
    | { id: string; name: string; properties?: Record<string, KitProperty> }
    | undefined {
    const nodeId = this.#nodeIdOf(refOrNodeId);
    if (!nodeId) return undefined;
    const variant = this.#variants.get(nodeId);
    if (!variant) return undefined;
    const set = this.#index.sets[variant.setId];
    return set
      ? { id: variant.setId, name: variant.setName, properties: set.properties }
      : undefined;
  }

  /**
   * The node Figma can actually export for a definition reference.
   *
   * Most definitions render directly. Hidden component sets are the exception:
   * the kit keeps their definitions as vocabulary and places visible instances
   * on the component page as the renderable examples.
   */
  renderableRef(ref: string): string {
    const nodeId = this.#nodeIdOf(ref);
    if (!nodeId) return ref;
    const renderId = this.#variants.get(nodeId)?.renderId;
    if (!renderId) return ref;
    return ref.startsWith("figma:") ? this.#refOf(renderId) : renderId;
  }

  /**
   * Some components are not variants of a set: a kit may model dividers as five
   * standalone components in a `Horizontal/…` / `Vertical/…` folder. Their
   * "variants" are their folder siblings, matched on the leaf name.
   */
  #componentSiblings(nodeId: string): IndexedStandalone[] | undefined {
    const self = this.#standaloneById.get(nodeId);
    if (!self) return undefined;
    const slash = self.name.lastIndexOf("/");
    if (slash < 0) return undefined;
    const folder = self.name.slice(0, slash);
    return this.#standalone.filter(
      (c) => c.name.startsWith(`${folder}/`) && c.id !== nodeId,
    );
  }

  #matchSibling(
    peers: IndexedStandalone[],
    seed: VariantSeed,
  ): IndexedStandalone | undefined {
    const want = [String(seed.raw), seed.key, `${seed.key}-${seed.raw}`].map(
      norm,
    );
    // Exact leaf first, then the shortest containing one. Without the ordering,
    // `inset` matches `Middle-inset` before `Inset` — a real divider, but the
    // wrong one, and a wrong reference is worse here than none.
    const scored: [number, number, IndexedStandalone][] = [];
    for (const peer of peers) {
      const leaf = norm(peer.name.slice(peer.name.lastIndexOf("/") + 1));
      if (want.some((w) => w === leaf)) scored.push([0, leaf.length, peer]);
      else if (want.some((w) => leaf.includes(w) || w.includes(leaf))) {
        scored.push([1, leaf.length, peer]);
      }
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored[0]?.[2];
  }

  /** The values an axis actually publishes across a set's variants. */
  #axisValues(set: KitSet, axis: string): string[] {
    const out = new Set<string>();
    for (const variant of set.variants) {
      const value = this.#variants.get(variant.id)?.axes[axis];
      if (value !== undefined) out.add(value);
    }
    return [...out];
  }

  /**
   * The published value that means BOTH `chosen` and `want` on the same axis.
   *
   * A kit sometimes folds two code knobs into one of its axes: a checkbox's
   * error state is not a `State` beside `Selected`, it is `Type=Error selected`
   * — one value carrying what a catalog spells as `state=unchecked,
   * status=error`. Without this each seed claims its own axis, the second finds
   * none left that accepts it, and variants the catalog already renders resolve
   * to nothing.
   *
   * Matched on the SET of words rather than by concatenation, so the published
   * value's word order need not agree with the seeds': `Error unselected`
   * matches `unselected` + `error` as readily as `error` + `unselected`.
   * Requiring set EQUALITY rather than containment is what keeps this from
   * being a wildcard — `Error unselected` is not a candidate for `unselected`
   * alone, and a third word in the published value means it says something
   * neither seed did.
   *
   * Note this is about the two values being fused, not about the order the
   * seeds arrive in: a seed that resolves to a no-op on its own axis is
   * skipped before it can claim one, so which seed comes first can still decide
   * whether a fusion is reached at all. Pinned as-is in the tests rather than
   * smoothed over, because the search order is what the catalog's own
   * annotation order feeds.
   */
  #fuseAxisValue(
    set: KitSet,
    axis: string,
    chosen: string,
    want: string,
  ): string | undefined {
    const wanted = new Set([...wordsOf(chosen), ...wordsOf(want)]);
    if (wanted.size < 2) return undefined;
    return this.#axisValues(set, axis).find((value) => {
      const have = wordsOf(value);
      return have.size === wanted.size && [...have].every((w) => wanted.has(w));
    });
  }

  /**
   * The kit node reached by applying every seed to a set variant's axis vector,
   * or `undefined` when the kit models no such axis.
   *
   * Every seed must map to a DISTINCT axis — except where the kit publishes one
   * value meaning both, which {@link #fuseAxisValue} handles — and the exact
   * resulting vector must name a real sibling. Searching axis-by-axis with
   * backtracking (rather than committing to the first plausible axis) is what
   * lets a multi-seed cell resolve when the obvious pairing is the wrong one.
   */
  #resolveSetVariant(
    base: IndexedVariant,
    seeds: VariantSeed[],
  ): ResolvedVariant | undefined {
    const set = this.#sets.get(base.setId);
    if (!set) return undefined;
    const eq = (a: unknown, b: unknown) =>
      String(a).toLowerCase() === String(b).toLowerCase();

    const search = (
      i: number,
      target: Record<string, string>,
      usedAxes: Set<string>,
    ): { id: string } | undefined => {
      if (i === seeds.length) {
        return set.variants.find((v) => {
          const indexed = this.#variants.get(v.id);
          if (!indexed) return false;
          return Object.keys(target).every((a) =>
            eq(indexed.axes[a], target[a]),
          );
        });
      }
      const seed = seeds[i];
      if (!seed) return undefined;
      for (const axis of axisCandidates(
        seed.key,
        base.axes,
        seed.raw,
        this.#vocabulary,
      )) {
        if (usedAxes.has(axis)) {
          // The axis is taken, which is not automatically a dead end: the kit
          // may model both seeds as one value of it.
          const chosen = target[axis];
          if (chosen === undefined) continue;
          for (const want of valueCandidates(seed.raw, this.#vocabulary)) {
            const fused = this.#fuseAxisValue(set, axis, chosen, want);
            if (!fused || eq(base.axes[axis], fused)) continue;
            const match = search(i + 1, { ...target, [axis]: fused }, usedAxes);
            if (match) return match;
          }
          continue;
        }
        for (const want of valueCandidates(seed.raw, this.#vocabulary)) {
          const noOp = eq(base.axes[axis], want);
          // Some shared matrices spell their default size explicitly in a
          // combination (`size=s, width=narrow, shape=square`). That seed is a
          // valid no-op there, but a one-axis no-op is only a duplicate of base.
          if (noOp && !(seeds.length > 1 && seed.key === "size")) continue;
          const match = search(
            i + 1,
            noOp ? target : { ...target, [axis]: want },
            new Set([...usedAxes, axis]),
          );
          if (match) return match;
        }
      }
      return undefined;
    };

    const match = search(0, base.axes, new Set());
    if (!match) return undefined;
    const indexed = this.#variants.get(match.id);
    if (!indexed) return undefined;
    return { nodeId: indexed.renderId ?? match.id, name: indexed.name };
  }

  /**
   * The kit node for `seeds` applied to the component referenced by `ref`.
   *
   * Resolution order is deliberate — **axes before properties**. An axis names
   * an exact sibling definition and is the stronger signal; projecting a seed
   * onto component properties first would let `Icon (selected)` steal the real
   * `Selected` axis, or a `Segments` slot steal a count axis.
   *
   * @returns the node and its kit name, or `undefined` when the kit models no
   *   such variation. Those misses are real gaps, to be reported rather than
   *   guessed at.
   */
  resolveVariant(
    ref: string,
    seedOrSeeds: VariantSeed | VariantSeed[],
  ): ResolvedVariant | undefined {
    const seeds = Array.isArray(seedOrSeeds) ? seedOrSeeds : [seedOrSeeds];
    const nodeId = this.#nodeIdOf(ref);
    if (!nodeId || !seeds.length) return undefined;

    const base = this.#variants.get(nodeId);
    if (base) return this.#resolveSetVariantOrProperty(nodeId, base, seeds);

    // Standalone-folder siblings are complete configurations, not independently
    // composable axes. Applying `subhead` and then `inset` would merely walk
    // from one sibling to another and falsely call the last one their
    // combination. Without an exact compound component to target, leave a
    // multi-seed standalone render unmapped.
    if (seeds.length > 1) return undefined;
    const siblings = this.#componentSiblings(nodeId);
    const seed = seeds[0];
    if (!siblings || !seed) return undefined;
    const hit = this.#matchSibling(siblings, seed);
    return hit ? { nodeId: hit.id, name: hit.name } : undefined;
  }

  #resolveSetVariantOrProperty(
    nodeId: string,
    base: IndexedVariant,
    seeds: VariantSeed[],
  ): ResolvedVariant | undefined {
    const exactAxisHit = this.#resolveSetVariant(base, seeds);
    if (exactAxisHit) return exactAxisHit;

    const set = this.#sets.get(base.setId);
    if (!set) return undefined;

    // Split the seeds: those the set can express as an axis, and those it can
    // only express as a property. A seed in neither camp makes the whole
    // combination unresolvable — it is not the kit's variation at all.
    const propertySeeds = seeds.filter(
      (seed) =>
        !this.#resolveSetVariant(base, [seed]) &&
        matchProperty(set.properties, seed.key, this.#vocabulary),
    );
    const axisSeeds = seeds.filter((seed) => !propertySeeds.includes(seed));

    const axisHit = axisSeeds.length
      ? this.#resolveSetVariant(base, axisSeeds)
      : undefined;
    if (axisSeeds.length && !axisHit) return undefined;
    if (!propertySeeds.length) return axisHit;

    // Properties hang off a variant DEFINITION, but `#resolveSetVariant` may
    // have returned a render alias in its place. Walk back to the definition,
    // since that is what an instance declares itself an instance of.
    const definitionId = axisHit
      ? set.variants.find(
          (child) =>
            (this.#variants.get(child.id)?.renderId ?? child.id) ===
            axisHit.nodeId,
        )?.id
      : nodeId;
    if (!definitionId) return undefined;

    const propertyHit = resolvePropertyInstance(
      set,
      definitionId,
      propertySeeds,
      this.#vocabulary,
    );
    if (!propertyHit) return undefined;

    const definition = this.#variants.get(definitionId);
    return {
      nodeId: propertyHit.nodeId,
      name: `${definition?.name ?? definitionId} (configured instance)`,
    };
  }

  /**
   * The kit property a knob names, when the kit models it as a property rather
   * than an axis — so there is no sibling node to compare against, and the miss
   * is a limit of references rather than a gap in the kit.
   */
  propertyForSeed(ref: string, seed: VariantSeed): SeedProperty | undefined {
    const set = this.#setForRef(ref);
    if (!set) return undefined;
    const properties = matchProperty(
      set.properties,
      seed.key,
      this.#vocabulary,
    );
    if (!properties) return undefined;

    const raw = String(seed.raw).toLowerCase();
    const seeded = TRUTHY.has(raw) ? true : FALSY.has(raw) ? false : undefined;
    return {
      setName: set.name,
      properties,
      coversVariant:
        seeded !== undefined &&
        properties.every((p) => p.type === "BOOLEAN" && p.default === seeded),
    };
  }

  /**
   * Optional content the kit switches ON by default, which every render made
   * from this reference therefore includes whether or not the code does.
   */
  defaultedContent(ref: string): DefaultedContent[] {
    const set = this.#setForRef(ref);
    if (!set) return [];
    return Object.entries(set.properties ?? {})
      .filter(([, def]) => def.type === "BOOLEAN" && def.default === true)
      .map(([name]) => ({ name, setName: set.name }));
  }
}
