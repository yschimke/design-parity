/**
 * Resolve a {@link Correspondence} to a single {@link DesignReference},
 * merging a multi-node manifest binding (issue: multi-node references).
 *
 * A `design-map.json` entry can bind one code component to several design nodes
 * — a screen's states, themes, or breakpoints living in separate frames. The
 * adapters stay single-node: this resolves each variant-tagged `ref` on its own,
 * re-tags the produced image(s) onto the variant slot the manifest declared, and
 * concatenates them into one reference. Structure/tokens come from the primary
 * (first) node. The variant tags then key each frame against its candidate
 * counterpart in the diff's `pairImages`, so the diff engine is unchanged.
 */
import type {
  AdapterContext,
  Correspondence,
  DesignReference,
  Image,
  ReferenceAdapter,
  RefVariant,
} from "@design-parity/core";

/** Re-tag an image with the variant slot the manifest assigned, if any. */
function applyVariant(image: Image, variant: RefVariant): Image {
  const out: Image = { ...image };
  if (variant.state !== undefined) out.state = variant.state;
  if (variant.theme !== undefined) out.theme = variant.theme;
  if (variant.size !== undefined) out.size = variant.size;
  return out;
}

/**
 * Resolve `corr` to one reference. A single-ref link resolves directly; a
 * multi-ref link resolves each node and merges the results.
 */
export async function resolveReference(
  adapter: ReferenceAdapter,
  corr: Correspondence,
  ctx: AdapterContext,
): Promise<DesignReference> {
  if (!corr.refs) return adapter.resolve(corr.code, corr.ref, ctx);

  const referenceImages: Image[] = [];
  let primary: DesignReference | undefined;
  for (const variant of corr.refs) {
    const reference = await adapter.resolve(corr.code, variant.ref, ctx);
    primary ??= reference;
    for (const image of reference.referenceImages) {
      referenceImages.push(applyVariant(image, variant));
    }
  }

  // `corr.refs` is non-empty (the resolver only sets it from a non-empty list),
  // so `primary` is always assigned.
  const base = primary as DesignReference;
  const merged: DesignReference = {
    componentId: base.componentId,
    source: base.source,
    linkMethod: base.linkMethod,
    referenceImages,
  };
  if (base.ref !== undefined) merged.ref = base.ref;
  if (base.tokens) merged.tokens = base.tokens;
  return merged;
}
