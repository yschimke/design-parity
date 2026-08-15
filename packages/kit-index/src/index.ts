/**
 * `@design-parity/kit-index` — the kit's own vocabulary, committed.
 *
 * A `design-map.json` entry binds a code component to ONE design node. That is
 * the right shape for a parity diff, and the wrong shape for a component that
 * renders several variants: a catalog that pictures `Button` at three sizes and
 * two shapes has six renders and one ref, and nothing says which kit node each
 * of the other five should be compared against.
 *
 * Enumerating them by hand is the mapping-config sprawl a design map exists to
 * avoid, and it drifts silently. So this package derives them instead — from
 * the kit's own published vocabulary, projected once into a committed index:
 *
 * ```text
 *   walk the kit's pages   ──▶  KitInventory   (disposable, big)
 *   project what the map references
 *   + fetch component properties
 *                          ──▶  KitIndex       (committed, small)
 *   resolve a knob against it
 *                          ──▶  ResolvedVariant
 * ```
 *
 * Resolution runs against the committed index, never the live kit, so a parity
 * run reports the same thing for everyone and needs no design-tool credentials.
 * Only the two generation steps touch the network, and both are deliberate
 * "refresh the vocabulary" operations a reviewer can see in a diff.
 *
 * **Three kinds of variation, and only two of them are addressable.** A variant
 * axis (`Size=Large`) is a sibling node with its own id. A component property
 * (`Show icon`) is not — a definition always renders at its defaults, so there
 * is no node id meaning "this button, without its icon". A configured
 * *instance* is the way out: somebody already placed one at the wanted vector,
 * and its node id is a read-only render handle for a point in property space
 * the definition cannot express. What remains genuinely unpairable — an
 * instance swap, a slot — is reported as unpaired rather than approximated.
 */

export type {
  DefaultedContent,
  KitIndexResolverOptions,
  SeedProperty,
} from "./resolve.js";
export { KitIndexResolver, slotFor } from "./resolve.js";

export {
  attachProperties,
  buildKitIndex,
  buildSkeleton,
  referencedNodeIds,
} from "./build.js";
export type {
  BuildKitIndexOptions,
  BuildKitIndexResult,
  KitSkeleton,
} from "./build.js";

export {
  classifyInstances,
  DEFAULT_WALK_DEPTH,
  dumpInventory,
  walkPage,
} from "./inventory.js";
export type { DumpInventoryOptions, PageWalk } from "./inventory.js";

export {
  matchProperty,
  resolvePropertyInstance,
  seededPropertyValue,
} from "./seeded-properties.js";
export type {
  MatchedProperty,
  PropertyInstanceHit,
} from "./seeded-properties.js";

export {
  axisCandidates,
  DEFAULT_AXIS_ALIASES,
  DEFAULT_VALUE_ALIASES,
  DEFAULT_VOCABULARY,
  mergeVocabulary,
  valueCandidates,
} from "./vocabulary.js";
export type { AxisAliases, ValueAliases, Vocabulary } from "./vocabulary.js";

export {
  KIT_INDEX_FILENAME,
  loadKitIndex,
  parseKitIndex,
  validateKitIndex,
} from "./load.js";

export {
  DESIGN_MAP_VARIANTS_SCHEMA,
  resolveDesignMapVariants,
} from "./design-map.js";
export type {
  ComponentVariantDeclaration,
  DefaultedContentReport,
  DesignMapVariants,
  PropertyVariantReport,
  ResolveDesignMapOptions,
  ResolveDesignMapResult,
  UnresolvedVariantReport,
  VariantCollisionReport,
  VariantRenderDeclaration,
} from "./design-map.js";

export type {
  InventoryComponent,
  InventoryInstance,
  InventoryMappedRef,
  InventoryPage,
  InventoryVariant,
  KitIndex,
  KitInstance,
  KitInventory,
  KitProperty,
  KitPropertyValue,
  KitSet,
  KitSpecimen,
  KitStandalone,
  KitVariant,
  ResolvedVariant,
  VariantSeed,
} from "./types.js";
