/**
 * The join: turn declared variant renders into design-map entries.
 *
 * This is the second half of a split that runs across two repositories, and the
 * seam is deliberate.
 *
 * `compose-ai-tools` owns the annotations (`@CatalogComponent`,
 * `@CatalogVariant`, `@OverrideVariant`) and projects them into a
 * `design-map.json` of **base** references plus a sidecar of **unresolved**
 * variant declarations — "this preview is the same component with `size=l`
 * turned". It stops there because `size=l` is a fact about a Compose API and
 * `Size=Large` is a fact about somebody's design kit; translating between them
 * needs that kit's published vocabulary, a design-tool credential to derive it,
 * and differs per kit.
 *
 * This module owns that translation. It reads the sidecar, resolves each
 * declared render against a committed {@link KitIndexResolver}, and folds the
 * results back into the map as tagged `ref`/`previewId` pairs beside the base
 * one — the shape `@design-parity/resolver` already reads.
 *
 * Pure. The I/O is the `resolve` subcommand of `design-parity-kit-index`.
 *
 * ## What a miss means
 *
 * Three of them, reported apart, because they have different owners:
 *
 * - **unresolved** — the kit models no such variation, by axis or by property.
 *   A badge's digit count. A real gap; nothing to do but say so.
 * - **property-shaped** — the kit HAS the thing, as a component property rather
 *   than a variant beside it, and no configured instance was indexed at the
 *   wanted values. The kit is fine; a node reference just cannot ask for it.
 * - **defaulted content** — the reference resolved, but the set switches some
 *   optional content on by default, so every render made from it includes
 *   content the code may not have drawn.
 *
 * Rolling these together is what makes a retired pattern read as neglect.
 */
import type { DesignMap, DesignMapEntry, RefVariant } from "@design-parity/core";

import { slotFor, type KitIndexResolver, type UnresolvedReason } from "./resolve.js";
import type { VariantSeed } from "./types.js";

/** The sidecar `schema` string this module reads. Anything else is refused. */
export const DESIGN_MAP_VARIANTS_SCHEMA =
  "compose-preview-design-map-variants/v1";

/** One declared variant render: a preview, and the knobs that make it differ. */
export interface VariantRenderDeclaration {
  previewId: string;
  /** What the variant goes by, for a report and for the `state` slot. */
  name: string;
  seeds: VariantSeed[];
}

/** Every variant render folding onto one component, with the ref to walk from. */
export interface ComponentVariantDeclaration {
  /** The design-map entry these belong to (`<path>#<function>`). */
  code: string;
  componentId: string;
  /** The base reference. Resolution walks outward from this node. */
  reference: string;
  basePreviewId: string;
  renders: VariantRenderDeclaration[];
}

/** The committed sidecar, as `compose-ai-tools` writes it. */
export interface DesignMapVariants {
  schema: string;
  components: ComponentVariantDeclaration[];
}

/** A variant the kit models as a component property rather than an axis. */
export interface PropertyVariantReport {
  code: string;
  componentId: string;
  variant: string;
  /** The seed vector, as `key=value` pairs. */
  vector: string;
  setName: string;
  properties: { name: string; type: string; default: unknown }[];
  /** The property's default already equals what this variant seeds. */
  coversVariant: boolean;
}

/** A variant with no counterpart in the kit at all. */
export interface UnresolvedVariantReport {
  code: string;
  componentId: string;
  variant: string;
  vector: string;
  /**
   * Which kind of miss this is. Without it every entry reads "no counterpart in
   * the kit", which is true of all of them and actionable for none — a reader
   * cannot tell a reference that already draws the variant from a vector the
   * kit's matrix skips from a value nobody has mapped.
   */
  reason: UnresolvedReason;
}

/** A reference that draws optional content whatever the code drew. */
export interface DefaultedContentReport {
  code: string;
  componentId: string;
  setName: string;
  properties: string[];
}

/**
 * Two distinct previews resolving to the same kit node.
 *
 * A contradiction rather than a near-miss: the same node cannot be both
 * previews' counterpart, and emitting it would have design-parity diff two
 * different renders against one reference and call one of them wrong. The
 * colliding variant is dropped and reported; the CLI refuses to write a map
 * that contains one.
 */
export interface VariantCollisionReport {
  code: string;
  componentId: string;
  ref: string;
  /** The variant that already owned the node. */
  owner: string;
  /** The variant that also resolved to it, and was dropped. */
  duplicate: string;
}

export interface ResolveDesignMapResult {
  map: DesignMap;
  diagnostics: {
    /** Variant renders folded into the map as tagged pairs. */
    resolved: number;
    /** Components whose entry gained variant refs. */
    components: number;
    unresolved: UnresolvedVariantReport[];
    propertyVariants: PropertyVariantReport[];
    defaulted: DefaultedContentReport[];
    collisions: VariantCollisionReport[];
    /** Declarations naming a `code` the map has no entry for. */
    orphaned: string[];
  };
}

const vectorOf = (seeds: VariantSeed[]): string =>
  seeds.map((seed) => `${seed.key}=${seed.raw}`).join(", ");

export interface ResolveDesignMapOptions {
  map: DesignMap;
  variants: DesignMapVariants;
  resolver: KitIndexResolver;
}

/**
 * Fold resolved variant references into a design map.
 *
 * The input map is not mutated — entries are copied, so a caller can compare
 * before and after, and a failed run leaves the committed file untouched.
 *
 * @throws Error if the sidecar's `schema` is not {@link DESIGN_MAP_VARIANTS_SCHEMA}.
 *   A sidecar written by a different producer describes a shape this cannot
 *   read, and guessing at it would silently emit a map of base refs alone —
 *   indistinguishable from a kit that resolved nothing.
 */
export function resolveDesignMapVariants(
  opts: ResolveDesignMapOptions,
): ResolveDesignMapResult {
  const { map, variants, resolver } = opts;

  if (variants.schema !== DESIGN_MAP_VARIANTS_SCHEMA) {
    throw new Error(
      `kit-index: unsupported variant sidecar schema '${variants.schema}' ` +
        `(expected '${DESIGN_MAP_VARIANTS_SCHEMA}')`,
    );
  }

  const declarations = new Map(
    variants.components.map((declaration) => [declaration.code, declaration]),
  );
  const claimed = new Set<string>();

  const unresolved: UnresolvedVariantReport[] = [];
  const propertyVariants: PropertyVariantReport[] = [];
  const defaulted: DefaultedContentReport[] = [];
  const collisions: VariantCollisionReport[] = [];
  let resolvedCount = 0;
  let componentCount = 0;

  const components = map.components.map((entry): DesignMapEntry => {
    const declaration = declarations.get(entry.code);
    // A ref that is already a tagged list was resolved by something else (a
    // hand-authored map, an earlier run). Re-deriving it would silently discard
    // whatever that was, so leave it alone.
    if (!declaration || typeof entry.ref !== "string") return { ...entry };
    claimed.add(entry.code);

    // Some kits keep component sets hidden: the definition is real vocabulary
    // but exports as a placeholder, and the kit's own visible instance is the
    // render handle. Applied to the base ref too, not just the variants — a
    // component with no variants is no more exportable than one with them.
    const baseRef = resolver.renderableRef(declaration.reference);

    const refs: RefVariant[] = [{ ref: baseRef }];
    const previewIds: { previewId: string }[] = [
      { previewId: declaration.basePreviewId },
    ];
    const owners = new Map<string, string>([[baseRef, "default"]]);

    for (const render of declaration.renders) {
      const hit = resolver.resolveVariant(declaration.reference, render.seeds);
      const vector = vectorOf(render.seeds);

      if (!hit) {
        const property = render.seeds
          .map((seed) => resolver.propertyForSeed(declaration.reference, seed))
          .find(Boolean);
        if (property) {
          propertyVariants.push({
            code: entry.code,
            componentId: declaration.componentId,
            variant: render.name,
            vector,
            setName: property.setName,
            properties: property.properties.map((p) => ({
              name: p.name,
              type: p.type,
              default: p.default,
            })),
            coversVariant: property.coversVariant,
          });
        } else {
          unresolved.push({
            code: entry.code,
            componentId: declaration.componentId,
            variant: render.name,
            vector,
            reason: resolver.explainUnresolved(declaration.reference, render.seeds),
          });
        }
        continue;
      }

      const resolvedRef = `figma:${resolver.fileKey}/${hit.nodeId}`;
      const owner = owners.get(resolvedRef);
      if (owner !== undefined) {
        collisions.push({
          code: entry.code,
          componentId: declaration.componentId,
          ref: resolvedRef,
          owner,
          duplicate: render.name,
        });
        continue;
      }
      owners.set(resolvedRef, render.name);

      const slot = slotFor(render.seeds, render.name);
      refs.push({ ref: resolvedRef, ...slot });
      previewIds.push({ previewId: render.previewId, ...slot });
      resolvedCount += 1;
    }

    const content = resolver.defaultedContent(declaration.reference);
    if (content.length) {
      defaulted.push({
        code: entry.code,
        componentId: declaration.componentId,
        setName: content[0]!.setName,
        properties: content.map((c) => c.name),
      });
    }

    // One ref stays the string shorthand: a single-element tagged list says
    // nothing the string does not, and it would churn every entry in the
    // committed map the first time a kit lost a variant.
    if (refs.length === 1) {
      return { ...entry, ref: baseRef, previewId: declaration.basePreviewId };
    }
    componentCount += 1;
    return { ...entry, ref: refs, previewId: previewIds };
  });

  const orphaned = [...declarations.keys()].filter((code) => !claimed.has(code));

  return {
    map: { ...map, components },
    diagnostics: {
      resolved: resolvedCount,
      components: componentCount,
      unresolved,
      propertyVariants,
      defaulted,
      collisions,
      orphaned,
    },
  };
}
