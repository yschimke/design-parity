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
  matchSeedProperty,
  resolvePropertyInstance,
  seededPropertyValue,
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
  sameName,
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

/**
 * A `kitAxis` / `kitValue` declaration naming something the kit does not have.
 *
 * The one miss whose fix is in the catalog's own source: somebody spelled the
 * kit's name by hand and got it wrong, or the kit renamed it since. Naming what
 * was declared beside what the set publishes is the difference between "this
 * resolved to nothing" and a one-line correction.
 */
export interface DeclaredMiss {
  /** The seed the declaration sits on, as `key=value`. */
  seed: string;
  /** Whether the kit lacks the declared axis, or the declared value of one. */
  declares: "axis" | "value";
  /** The name the declaration gave. */
  named: string;
  /** What the kit publishes there: the set's axes, or the axis's values. */
  published: string[];
}

/**
 * Why a vector resolved to nothing — see {@link KitIndexResolver.explainUnresolved}.
 *
 * Four answers, and a reader does something different with each: `declared` is
 * a mistake in the catalog, `base` is not a gap at all, `combination` is a gap
 * in the kit's matrix rather than in its vocabulary, and `seeds` names what to
 * go and look for.
 */
export type UnresolvedReason =
  /** A `kitAxis` / `kitValue` declaration names something the kit does not publish. */
  | { kind: "declared"; missing: DeclaredMiss[] }
  /** The reference already draws this: the base variant carries every seeded value. */
  | { kind: "base"; variant: string }
  /** Each seed resolves alone; the kit draws no node carrying them together. */
  | { kind: "combination"; seeds: string[] }
  /** These seeds have no counterpart at all — the actual gap. */
  | { kind: "seeds"; missing: string[] };

/** `key=value`, the form the reports quote a seed in. */
const vectorPart = (seed: VariantSeed): string => `${seed.key}=${String(seed.raw)}`;

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

  /** The leaf name of a `Folder/Leaf` standalone component. */
  #leafOf(component: IndexedStandalone): string {
    return component.name.slice(component.name.lastIndexOf("/") + 1);
  }

  #matchSibling(
    peers: IndexedStandalone[],
    seed: VariantSeed,
  ): IndexedStandalone | undefined {
    // A declared value names the sibling outright, so it is matched exactly and
    // nothing else is tried: the near-miss search below is what a declaration
    // exists to replace, and `Inset` losing to `Middle-inset` is exactly the
    // wrong answer somebody would declare their way out of.
    if (seed.kitValue !== undefined) {
      const declared = seed.kitValue;
      return peers.find((peer) => sameName(this.#leafOf(peer), declared));
    }
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
   * The axis's own spelling of `want`, matched without separators or case.
   *
   * Code knobs slug what a kit spaces and capitalises — `center-aligned-hero`
   * is the kit's `Center-aligned hero`, hyphen in one place and space in the
   * other, which no amount of swapping one for the other reaches. Normalising
   * both sides to letters and digits does, and it can only ever return a value
   * the axis actually publishes, so a spelling the kit does not have still
   * resolves to nothing. This is the general form of the hand-written
   * `secondary-container` style entries in {@link DEFAULT_VALUE_ALIASES}.
   */
  #publishedValue(
    set: KitSet,
    axis: string,
    want: string | undefined,
  ): string | undefined {
    if (want === undefined) return undefined;
    // Only for MULTI-WORD slugs. Normalising strips every separator, and that
    // is too strong for a bare number: `progress=1.0` normalises to `10`, which
    // is a real value of a `Progress` axis and the wrong one — the candidate
    // list already turns 1.0 into `100` for exactly that axis. A hyphen or a
    // space is what says "this is a phrase the kit spells with its own
    // spacing".
    if (!/[-\s]/.test(want)) return undefined;
    const target = norm(want);
    return this.#axisValues(set, axis).find((value) => norm(value) === target);
  }

  /**
   * The set's own spelling of a declared kit axis, or `undefined` when the set
   * publishes no such axis.
   *
   * Matched without case or separators, the same normalisation
   * {@link #publishedValue} uses, so a declaration reads as the kit prints it
   * (`Show avatar`, `# of lines`) without anyone having to reproduce its
   * punctuation exactly. What it will not do is find something else nearby: a
   * declaration is the author asserting the kit's own name, so the only useful
   * answer to a name the kit does not have is none.
   */
  #declaredAxis(
    axes: Record<string, string>,
    declared: string,
  ): string | undefined {
    return Object.keys(axes).find((axis) => sameName(axis, declared));
  }

  /** The axis's own spelling of a declared kit value, if it publishes one. */
  #declaredValue(
    set: KitSet,
    axis: string,
    declared: string,
  ): string | undefined {
    return this.#axisValues(set, axis).find((value) => sameName(value, declared));
  }

  /**
   * The axes a seed may claim: the one it declares, or the ones the vocabulary
   * proposes for its key. A declaration the set does not publish yields NO
   * candidates rather than falling back — see {@link VariantSeed.kitAxis}.
   */
  #axesFor(seed: VariantSeed, axes: Record<string, string>): string[] {
    if (!seed.kitAxis) {
      return axisCandidates(seed.key, axes, seed.raw, this.#vocabulary);
    }
    const declared = this.#declaredAxis(axes, seed.kitAxis);
    return declared ? [declared] : [];
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
      for (const axis of this.#axesFor(seed, base.axes)) {
        // A declared value skips the alias tables entirely, and skips the axis
        // when that axis does not publish it — the declaration is a claim about
        // the kit, so a claim the kit contradicts resolves to nothing.
        const declared = seed.kitValue
          ? this.#declaredValue(set, axis, seed.kitValue)
          : undefined;
        if (seed.kitValue && !declared) continue;

        if (usedAxes.has(axis)) {
          // The axis is taken, which is not automatically a dead end: the kit
          // may model both seeds as one value of it.
          const chosen = target[axis];
          if (chosen === undefined) continue;
          // A declared value on a taken axis is a claim that the kit fuses both
          // seeds into it — so it goes through the same check any fusion does.
          // Taking it on trust would let the second seed's declaration overwrite
          // the first seed's value outright: a checkbox at `Type=Selected` whose
          // error seed declares `Error unselected` would resolve to the
          // unselected node and diff selected code against it.
          const wants = declared
            ? [declared]
            : valueCandidates(seed.raw, this.#vocabulary);
          for (const want of wants) {
            const fusedWith = this.#fuseAxisValue(set, axis, chosen, want);
            const fused =
              declared === undefined
                ? fusedWith
                : fusedWith === declared
                  ? declared
                  : undefined;
            if (!fused || eq(base.axes[axis], fused)) continue;
            const match = search(i + 1, { ...target, [axis]: fused }, usedAxes);
            if (match) return match;
          }
          continue;
        }
        for (const candidate of declared
          ? [declared]
          : valueCandidates(seed.raw, this.#vocabulary)) {
          const want =
            declared ?? this.#publishedValue(set, axis, candidate) ?? candidate;
          const noOp = eq(base.axes[axis], want);
          // Some shared matrices spell their default size explicitly in a
          // combination (`size=s, width=narrow, shape=square`). That seed is a
          // valid no-op there, but a one-axis no-op is only a duplicate of base.
          //
          // A DECLARED seed qualifies whatever the code calls its knob: the
          // author has named the axis and the value outright, which is the same
          // "I mean this cell sits here" the `size` key stands in for — and
          // requiring the code-side spelling would make the exception depend on
          // the one thing a declaration exists to stop mattering.
          const spellsDefault =
            seed.key === "size" ||
            seed.kitValue !== undefined ||
            (seed.kitAxis !== undefined && sameName(axis, "Size"));
          if (noOp && !(seeds.length > 1 && spellsDefault)) continue;
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
    // A folder-modelled family publishes no axes at all, so a `kitAxis` here
    // names nothing that could be honoured. Refused rather than ignored: a
    // declaration that quietly falls back to the guess it was written to
    // replace is worse than one that resolves to nothing and says so.
    if (seed.kitAxis !== undefined) return undefined;
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
        // A declared kit name reaches a property as readily as an axis: which
        // of the two a kit models a knob as is the kit's business, not the
        // declaration's. Matched exactly when declared — see matchSeedProperty.
        matchSeedProperty(set.properties, seed, this.#vocabulary),
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
    const properties = matchSeedProperty(set.properties, seed, this.#vocabulary);
    if (!properties) return undefined;

    // The declared value is the one the kit knows this cell by, so it decides
    // whether the property's default already covers the variant.
    const raw = String(seed.kitValue ?? seed.raw).toLowerCase();
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
   * Why a set of seeds resolved to nothing.
   *
   * "No counterpart in the kit" is true of every miss and useful about almost
   * none of them, because it collapses three different situations a reader has
   * to act on differently. Working out which one you are looking at otherwise
   * means re-resolving seeds by hand against the kit index — which is exactly
   * what this does, once, at the point the miss is recorded.
   *
   * Call only after {@link resolveVariant} has already returned `undefined`;
   * on a resolvable vector the answer is meaningless.
   */
  explainUnresolved(ref: string, seeds: VariantSeed[]): UnresolvedReason {
    // A declaration naming something the kit does not publish comes first: it
    // is the only miss whose fix is in the catalog's own source, and every
    // other answer below would be a true statement about a vector nobody meant.
    // Left unreported it is the worst of both worlds — the author took the
    // trouble to name the kit's own spelling and got silence for it.
    const base = this.#baseVariant(ref);
    if (!base) {
      const standalone = this.#standaloneReason(ref, seeds);
      if (standalone) return standalone;
    } else {
      const declared = this.#declaredMisses(base, seeds);
      if (declared.length) return { kind: "declared", missing: declared };
    }

    // A seed whose value the base variant already carries is not a gap at all:
    // the reference IS that variant, and the render duplicates it. `Size=Small`
    // on a catalog whose base preview is the small one reads as a missing node
    // otherwise, and there is nothing to go looking for.
    if (base) {
      const covered = seeds.filter((seed) => this.#seedMatchesBase(base, seed));
      if (covered.length === seeds.length) {
        return { kind: "base", variant: base.name };
      }
    }

    // Each seed alone. The split matters: if they all resolve individually the
    // kit knows every value and simply draws no node at their intersection,
    // which is a fact about the kit's matrix. If some do not, those are the
    // gap, and naming them is the difference between a lead and a list.
    const missing = seeds.filter((seed) => !this.resolveVariant(ref, [seed]));
    if (missing.length === 0) {
      return { kind: "combination", seeds: seeds.map(vectorPart) };
    }
    return { kind: "seeds", missing: missing.map(vectorPart) };
  }

  /** The indexed variant a ref points at, when it points at one. */
  #baseVariant(ref: string): IndexedVariant | undefined {
    const nodeId = this.#nodeIdOf(ref);
    return nodeId ? this.#variants.get(nodeId) : undefined;
  }

  /** True when the base variant already sits at the value this seed asks for. */
  #seedMatchesBase(base: IndexedVariant, seed: VariantSeed): boolean {
    for (const axis of this.#axesFor(seed, base.axes)) {
      const at = base.axes[axis];
      if (at === undefined) continue;
      // A declared value is compared the way it was looked up. Comparing it
      // with the slug normalisation would call `状態=通常` and `状態=無効` the
      // same value — both erase to nothing — and report a missing node as one
      // the reference already draws.
      if (seed.kitValue !== undefined) {
        if (sameName(at, seed.kitValue)) return true;
        continue;
      }
      for (const candidate of valueCandidates(seed.raw, this.#vocabulary)) {
        if (norm(at) === norm(candidate)) return true;
      }
    }
    return false;
  }

  /**
   * Declarations this set cannot honour, one entry per offending seed.
   *
   * Checked against the set the reference belongs to, so "the kit does not
   * publish that" is a statement about the component being resolved rather than
   * about the kit at large — an axis that is real on the buttons and absent on
   * the tabs is exactly the mistake worth catching.
   */
  #declaredMisses(base: IndexedVariant, seeds: VariantSeed[]): DeclaredMiss[] {
    const set = this.#sets.get(base.setId);
    if (!set) return [];

    const misses: DeclaredMiss[] = [];
    for (const seed of seeds) {
      const axis = seed.kitAxis
        ? this.#declaredAxis(base.axes, seed.kitAxis)
        : undefined;
      if (seed.kitAxis && !axis) {
        // A kit is free to model the declared name as a component PROPERTY instead of an axis, and
        // a property-shaped variant is unpaired for a different reason entirely — no definition
        // renders at a non-default property vector. Calling that a misspelt declaration would
        // rename a known limitation as an authoring error, and (since the declared reason outranks
        // the property one) hide the report that says which property it is.
        const properties = matchSeedProperty(set.properties, seed, this.#vocabulary);
        if (properties) {
          const valueMiss = this.#declaredPropertyValueMiss(seed, properties);
          if (valueMiss) misses.push(valueMiss);
          continue;
        }
        misses.push({
          seed: vectorPart(seed),
          declares: "axis",
          named: seed.kitAxis,
          published: Object.keys(base.axes),
        });
        continue;
      }
      const value = seed.kitValue;
      if (!value) continue;
      // With no declared axis, the value's home is whichever candidate axis
      // publishes it. Reporting a miss only when NONE does keeps this from
      // firing on a value that resolves perfectly well on the axis the seed's
      // own key names.
      const candidates = axis ? [axis] : this.#axesFor(seed, base.axes);
      if (candidates.some((a) => this.#declaredValue(set, a, value))) continue;

      // No axis carries it — but the knob may be one the kit models as a
      // component property, which has no published value list to check against
      // and is judged by what the property can represent instead. Skipping this
      // reported a perfectly good `Show focus indicator=True` as a bad
      // declaration, and (since the declared reason outranks the property one)
      // took a property-shaped variant out of its own report on the way.
      const properties = matchSeedProperty(set.properties, seed, this.#vocabulary);
      if (properties) {
        const valueMiss = this.#declaredPropertyValueMiss(seed, properties);
        if (valueMiss) misses.push(valueMiss);
        continue;
      }

      misses.push({
        seed: vectorPart(seed),
        declares: "value",
        named: value,
        published: [
          ...new Set(candidates.flatMap((a) => this.#axisValues(set, a))),
        ],
      });
    }
    return misses;
  }

  /**
   * A value declared for a component PROPERTY that the property cannot take.
   *
   * The name being real is not the whole check. `Show icon` with a declared
   * `Flase` resolves to no instance, and without this it would be filed as an
   * accepted property-shaped variant — the one classification that says
   * "nothing to fix here" — so a typo would hide behind a known limitation.
   *
   * Only asked of properties that have a representable value at all. An
   * instance swap or a slot can never be addressed by a catalog seed, declared
   * or not, and reporting those as a bad declaration would be the same
   * mislabelling in the other direction.
   */
  #declaredPropertyValueMiss(
    seed: VariantSeed,
    properties: MatchedProperty[],
  ): DeclaredMiss | undefined {
    const value = seed.kitValue;
    if (value === undefined) return undefined;
    const representable = properties.filter(
      (property) => property.type === "BOOLEAN" || property.type === "TEXT",
    );
    if (!representable.length) return undefined;
    const usable = representable.every(
      (property) => seededPropertyValue(property, seed, properties) !== undefined,
    );
    if (usable) return undefined;
    return {
      seed: vectorPart(seed),
      declares: "value",
      named: value,
      // A boolean switch takes two values and a text property takes any string,
      // so what is listable here is the booleans' pair.
      published: representable.some((property) => property.type === "BOOLEAN")
        ? ["True", "False"]
        : [],
    };
  }

  /**
   * The same check for a component the kit models as folder siblings.
   *
   * Two things can be declared at a family with no axes: an axis, which nothing
   * there could ever honour, and a value, which must name one of the siblings.
   * Both are reported against the sibling leaves, since that is the whole
   * vocabulary such a family has.
   *
   * The referenced component counts among them. `#componentSiblings` excludes
   * it — it is the node being walked *from* — but a declaration naming it is
   * the standalone form of the `base` case, not a mistake: the reference
   * already draws exactly what the render asked for.
   */
  #standaloneReason(
    ref: string,
    seeds: VariantSeed[],
  ): UnresolvedReason | undefined {
    const nodeId = this.#nodeIdOf(ref);
    const self = nodeId ? this.#standaloneById.get(nodeId) : undefined;
    const siblings = nodeId ? this.#componentSiblings(nodeId) : undefined;
    if (!self || !siblings) return undefined;
    const leaves = siblings.map((peer) => this.#leafOf(peer));
    const own = this.#leafOf(self);

    const misses: DeclaredMiss[] = [];
    // Every seed is inspected before a verdict: a render whose first declaration names the
    // reference itself and whose second is misspelt is not "already drawn", and returning on the
    // first would hide the one thing there is to fix.
    let drawn = false;
    for (const seed of seeds) {
      if (seed.kitAxis !== undefined) {
        misses.push({
          seed: vectorPart(seed),
          declares: "axis",
          named: seed.kitAxis,
          published: [],
        });
        continue;
      }
      const value = seed.kitValue;
      if (value === undefined) continue;
      if (sameName(own, value)) {
        drawn = true;
        continue;
      }
      if (leaves.some((leaf) => sameName(leaf, value))) continue;
      misses.push({
        seed: vectorPart(seed),
        declares: "value",
        named: value,
        published: [own, ...leaves],
      });
    }
    if (misses.length) return { kind: "declared", missing: misses };
    return drawn ? { kind: "base", variant: self.name } : undefined;
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
