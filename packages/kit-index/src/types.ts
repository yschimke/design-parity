/**
 * The committed shapes: what a kit inventory records, and what the kit index
 * distilled from it holds.
 *
 * Both are **outputs** — regenerate, never hand-edit. The inventory is the raw
 * walk of a design kit's pages and is disposable; the kit index is the small
 * committed projection of it that a resolver reads, and it belongs in the repo
 * next to `design-map.json` for the same reason the map does: a build that
 * needs a live design tool to say what a reference means is a build that
 * reports differently depending on who ran it.
 */

/** A design kit's own coordinates: which file, addressed by which node ids. */
export interface KitVariant {
  /** The variant `COMPONENT`'s node id — the vocabulary handle. */
  id: string;
  /** Figma's axis-vector name, e.g. `Type=Round, Size=Small, State=Enabled`. */
  name: string;
  /**
   * A different node to export images from, when {@link id} cannot be
   * rendered. Some kits keep component sets deliberately hidden: the
   * definitions are real vocabulary, but `GET /v1/images` returns a 1px
   * placeholder for them. Such kits place one visible instance of each variant
   * on the component page, and that instance is the render handle.
   */
  renderId?: string;
}

/**
 * A component-property value.
 *
 * Mostly a boolean or a string, but a `SLOT` default is an opaque object (a
 * Figma guid). It is recorded as-is rather than flattened: nothing here needs
 * to interpret it, and comparison is structural, so preserving it costs
 * nothing and stringifying it would invent a format.
 */
export type KitPropertyValue =
  | boolean
  | string
  | number
  | Record<string, unknown>;

/**
 * One property a component set declares, as the index records it: the type and
 * the value a render gets when nobody overrides it.
 *
 * Note what is absent — the `#id` suffix Figma puts on property keys. The index
 * stores the name a designer sees, because that is the name a report has to
 * print and the name a knob has to match against.
 *
 * `SLOT` is here because real kits use it (the Material 3 kit has a dozen), not
 * because anything can pair against one. A slot names a region someone drops
 * content into; a catalog knob says what the content *means*, never which node
 * fills it, so a slot-shaped variant stays explicitly unpaired. Recording the
 * type is what makes that distinguishable from "the kit has no such knob".
 */
export interface KitProperty {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "SLOT";
  default: KitPropertyValue;
}

/**
 * A visible instance in the kit, already configured at a known property vector.
 *
 * This is the answer to the problem that makes property-shaped variants
 * unpairable. A component *definition* always renders at its property defaults,
 * so there is no node id that means "this button, without its icon". An
 * instance someone already configured that way is such a node id — a read-only
 * render handle for a point in property space the definition cannot express,
 * obtained without mutating the kit.
 */
export interface KitInstance {
  /** The `INSTANCE`'s own node id: what gets rendered. */
  id: string;
  /** The variant `COMPONENT` this instance is of. */
  componentId: string;
  /**
   * The full property vector this instance renders at — every property the set
   * declares, with the instance's chosen value or the set's default. Complete
   * rather than sparse, so an exact match is an equality check on the whole
   * vector and never an accident of which keys happened to be recorded.
   */
  properties: Record<string, KitPropertyValue>;
}

/** A component set: its variants (the axes) and its properties (the rest). */
export interface KitSet {
  name: string;
  variants: KitVariant[];
  /** Absent when the set declares none, or when the index was built anonymously. */
  properties?: Record<string, KitProperty>;
  /** Absent when the kit has no configured instance of this set worth keeping. */
  instances?: KitInstance[];
}

/**
 * A component that is not a variant of a set. Some kits model a family as
 * sibling components in a `Horizontal/…` folder rather than as one set, and the
 * folder is then the variant vocabulary.
 */
export interface KitStandalone {
  name: string;
}

/**
 * A referenced node that is not a component at all — a typography, colour or
 * shape specimen frame. Recorded so the index can prove the reference exists
 * without pretending it has a variant vocabulary.
 */
export interface KitSpecimen {
  name: string;
  type: string;
}

/** The committed kit index. */
export interface KitIndex {
  /** The design file these node ids are addressed within. */
  fileKey: string;
  /** What wrote this file, for a reader who finds it and wonders. */
  generatedBy: string;
  sets: Record<string, KitSet>;
  standalone: Record<string, KitStandalone>;
  specimens: Record<string, KitSpecimen>;
}

// --- The raw walk ------------------------------------------------------------

/** One variant node as the page walk saw it (before properties are known). */
export interface InventoryVariant {
  name: string;
  id: string;
  w: number;
  h: number;
  radius: number | string | null;
}

/** A `COMPONENT` or `COMPONENT_SET` found on a page. */
export interface InventoryComponent {
  name: string;
  id: string;
  type: "COMPONENT" | "COMPONENT_SET";
  level: number;
  /** Hidden here or under a hidden ancestor — a set kept as vocabulary only. */
  hidden: boolean;
  w: number;
  h: number;
  radius: number | string | null;
  /** Layer-name trail from the page root, for a human reading the dump. */
  trail: string;
  children: InventoryVariant[];
}

/** A visible `INSTANCE` found on a page, with the values it was configured at. */
export interface InventoryInstance {
  id: string;
  componentId: string;
  name: string;
  properties: Record<string, { type: string; value: KitPropertyValue }>;
  trail: string;
  /** Whether the instance sits under a frame named `Example`/`Examples`. */
  example: boolean;
  w: number;
  h: number;
}

export interface InventoryPage {
  page: string;
  pageId: string;
  /** Deepest level the walk reached — how much of the tree `depth` bought. */
  deepest: number;
  components: InventoryComponent[];
  /** Instances that stand in for a hidden set's unrenderable definitions. */
  renderInstances: InventoryInstance[];
  /** Instances of referenced sets carrying a non-default property vector. */
  propertyInstances: InventoryInstance[];
  /** Set when the page could not be read; the other fields are then empty. */
  error?: string;
}

/** One already-mapped reference, resolved back to what it actually points at. */
export interface InventoryMappedRef {
  /** The code handle from the design map. */
  code: string;
  nodeId: string;
  found: boolean;
  name: string | null;
  type: string | null;
  hidden: boolean;
  w: number;
  h: number;
  radius: number | string | null;
  children: number;
}

/** The raw page-by-page dump the index is projected from. */
export interface KitInventory {
  fileKey: string;
  depth: number;
  pages: InventoryPage[];
  mapped: InventoryMappedRef[];
}

// --- Resolution inputs -------------------------------------------------------

/**
 * One knob a catalog variant turns, as the code side declares it.
 *
 * `key` is the code's own name for the axis (`size`, `content`, `state`) and
 * `raw` is the value as authored (`l`, `icon+label`, `2`). Neither is in the
 * kit's vocabulary — translating between the two is the whole job of this
 * package, and it is a translation checked against the kit rather than a guess.
 */
export interface VariantSeed {
  key: string;
  raw: string | number | boolean;
}

/** A kit node a seed resolved to, and the name that node goes by. */
export interface ResolvedVariant {
  nodeId: string;
  name: string;
}
