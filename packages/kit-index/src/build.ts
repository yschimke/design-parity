/**
 * Project the committed kit index out of a design map and a page walk.
 *
 * WHY THIS IS GENERATED AND NOT HAND-WRITTEN. The index is an input to variant
 * resolution, and a hand-built one goes quietly out of date the first time the
 * kit gains a variant. Quiet is the whole problem: a missing variant reads as
 * "no counterpart in the kit" rather than "nobody looked", and the two call for
 * opposite responses from whoever reads the report.
 *
 * WHY IT CALLS THE API AT ALL, given a walk already happened. The walk sees
 * variant *names*, which carry the axes. It does not see
 * `componentPropertyDefinitions` — Figma returns those only for nodes requested
 * directly, never for one reached by descending a page. Properties are where a
 * kit keeps everything the axes do not (whether a button draws its icon,
 * whether a card has an action row), and an index that omits them describes
 * something other than what a reader will see.
 *
 * The index is scoped to what the map references. A kit has thousands of nodes
 * and a catalog points at dozens; keeping the rest would make the committed
 * file a second copy of the design document, which is exactly the thing a
 * committed index exists to avoid needing.
 */
import type { DesignMap, RefVariant } from "@design-parity/core";
import { entryRefs } from "@design-parity/core";
import type { FigmaRestClient } from "@design-parity/adapter-figma";
import { propertyName } from "@design-parity/adapter-figma";

import type {
  InventoryComponent,
  InventoryInstance,
  KitIndex,
  KitInstance,
  KitInventory,
  KitProperty,
  KitPropertyValue,
  KitSet,
  KitSpecimen,
  KitStandalone,
} from "./types.js";

/** Node ids per `/nodes` request. Small enough to retry cheaply, large enough to matter. */
const BATCH = 40;

/**
 * Every node id the map points at in `fileKey`, across both the string and the
 * tagged-list form of `ref`.
 *
 * Refs naming a different file are skipped rather than stripped of their key: a
 * repo may map some components to one kit and some to another, and an index is
 * always about one file.
 */
export function referencedNodeIds(
  map: Pick<DesignMap, "components">,
  fileKey: string,
): Set<string> {
  const out = new Set<string>();
  for (const entry of map.components ?? []) {
    for (const variant of entryRefs(entry) as RefVariant[]) {
      if (!variant.ref.startsWith("figma:")) continue;
      const rest = variant.ref.slice("figma:".length);
      // `figma:<fileKey>/<nodeId>`, and the node id itself contains a colon —
      // so strip the scheme, then split on the FIRST slash only.
      const slash = rest.indexOf("/");
      if (slash < 0) continue;
      if (rest.slice(0, slash) === fileKey) out.add(rest.slice(slash + 1));
    }
  }
  return out;
}

/** Every component the walk found, flattened across pages with its page kept. */
interface PagedComponent extends InventoryComponent {
  renderInstances: InventoryInstance[];
}

function pagedComponents(inventory: KitInventory): PagedComponent[] {
  const out: PagedComponent[] = [];
  for (const page of inventory.pages) {
    for (const component of page.components) {
      out.push({ ...component, renderInstances: page.renderInstances });
    }
  }
  return out;
}

/** The vocabulary skeleton: which sets, standalones and specimens to keep. */
export interface KitSkeleton {
  sets: Record<string, KitSet>;
  standalone: Record<string, KitStandalone>;
  /** Referenced ids that are no component at all — specimen frames. */
  specimenIds: string[];
}

/**
 * Decide what the index keeps, from the walk alone.
 *
 * A referenced node is either one variant of a set — in which case the whole
 * set is the vocabulary for that component — or a standalone component. Keep
 * the standalone itself unconditionally; when its name has a `Horizontal/…`
 * style folder, its siblings form the variant vocabulary and are kept beside
 * it.
 *
 * Pure, so the keep/drop decisions can be pinned without a kit or a network.
 */
export function buildSkeleton(
  inventory: KitInventory,
  referenced: ReadonlySet<string>,
): KitSkeleton {
  const components = pagedComponents(inventory);

  const keepSets = new Set<string>();
  const keepFolders = new Set<string>();
  const keepStandalone = new Set<string>();
  for (const c of components) {
    if (referenced.has(c.id)) {
      if (c.children.length) {
        keepSets.add(c.id);
      } else {
        keepStandalone.add(c.id);
        if (c.name.includes("/")) {
          keepFolders.add(c.name.slice(0, c.name.lastIndexOf("/")));
        }
      }
    }
    for (const v of c.children) if (referenced.has(v.id)) keepSets.add(c.id);
  }

  const sets: Record<string, KitSet> = {};
  const standalone: Record<string, KitStandalone> = {};
  for (const c of components) {
    if (keepSets.has(c.id)) {
      sets[c.id] = {
        name: c.name,
        variants: c.children.map((v) => {
          // A few kit component sets are deliberately hidden. Figma returns
          // their definition ids from `/nodes`, but `/images` exports them as a
          // 1px placeholder or "node not found". Component pages place one
          // visible instance of every variant under an Examples frame; use that
          // instance as the render handle while retaining the definition id as
          // vocabulary. Exactly one, or the choice would be arbitrary.
          const examples = c.renderInstances.filter(
            (instance) => instance.componentId === v.id && instance.example,
          );
          const alias = c.hidden && examples.length === 1 ? examples[0] : undefined;
          return {
            id: v.id,
            name: v.name,
            ...(alias ? { renderId: alias.id } : {}),
          };
        }),
      };
    }
    if (
      keepStandalone.has(c.id) ||
      (c.name.includes("/") &&
        keepFolders.has(c.name.slice(0, c.name.lastIndexOf("/"))))
    ) {
      standalone[c.id] = { name: c.name };
    }
  }

  // Foundation sheets such as typography, colour and shape are specimen frames
  // rather than components. They are still valid design-led references, but
  // have no variant vocabulary to keep — so they are recorded as what they are
  // rather than forced into `sets`.
  const componentIds = new Set(
    components.flatMap((c) => [c.id, ...c.children.map((v) => v.id)]),
  );
  const specimenIds = [...referenced].filter((id) => !componentIds.has(id));

  return { sets, standalone, specimenIds };
}

/**
 * Attach a set's component properties and its configured-instance render
 * handles, given the definitions fetched for that set.
 *
 * Pure, and the heart of the property-instance pairing: it decides which
 * instances are worth committing and what property vector each one stands for.
 */
export function attachProperties(
  set: KitSet,
  definitions: Record<string, { type: string; defaultValue: KitPropertyValue }>,
  candidateInstances: InventoryInstance[],
): { properties: number; instances: number } {
  // VARIANT entries restate the axes already in the variant names; the rest is
  // what a reference render silently applies at its default.
  const props: [string, KitProperty][] = Object.entries(definitions)
    .filter(([, v]) => v.type !== "VARIANT")
    .map(([k, v]) => [
      propertyName(k),
      { type: v.type as KitProperty["type"], default: v.defaultValue },
    ]);
  if (!props.length) return { properties: 0, instances: 0 };

  set.properties = Object.fromEntries(props);

  const variantIds = new Set(set.variants.map((v) => v.id));
  const candidates = candidateInstances.filter((i) =>
    variantIds.has(i.componentId),
  );
  // One exact property vector needs only one render handle. Prefer an
  // Examples-frame instance, then the smaller node, so the committed index
  // stays stable when the kit repeats the same configuration.
  candidates.sort(
    (a, b) =>
      Number(b.example) - Number(a.example) ||
      a.w * a.h - b.w * b.h ||
      a.id.localeCompare(b.id),
  );

  const seen = new Set<string>();
  const instances: KitInstance[] = [];
  for (const instance of candidates) {
    const values: Record<string, KitPropertyValue> = Object.fromEntries(
      props.map(([name, def]) => [
        name,
        instance.properties[name]?.value ?? def.default,
      ]),
    );
    const vector = `${instance.componentId} ${JSON.stringify(values)}`;
    if (seen.has(vector)) continue;
    seen.add(vector);
    instances.push({
      id: instance.id,
      componentId: instance.componentId,
      properties: values,
    });
  }
  if (instances.length) set.instances = instances;

  return { properties: 1, instances: instances.length };
}

export interface BuildKitIndexOptions {
  map: Pick<DesignMap, "components">;
  inventory: KitInventory;
  fileKey: string;
  /**
   * Client used to read component-property definitions and specimen names.
   * Omit for an offline rebuild: the skeleton is derivable from the walk alone,
   * and the result is then an index with no property vocabulary — honest, but
   * unable to pair a property-shaped variant.
   */
  client?: FigmaRestClient;
  /**
   * A previously generated index, used only when `client` is absent: its
   * specimen names are carried forward so an offline rebuild does not silently
   * drop vocabulary an authenticated run had established.
   */
  previous?: Pick<KitIndex, "specimens">;
  /** What to record as having written the file. */
  generatedBy?: string;
  log?: (message: string) => void;
}

export interface BuildKitIndexResult {
  index: KitIndex;
  stats: {
    sets: number;
    variants: number;
    renderAliases: number;
    standalone: number;
    specimens: number;
    propertied: number;
    configuredInstances: number;
  };
}

/** Build the committed index. */
export async function buildKitIndex(
  opts: BuildKitIndexOptions,
): Promise<BuildKitIndexResult> {
  const {
    map,
    inventory,
    fileKey,
    client,
    previous,
    generatedBy = "@design-parity/kit-index",
    log = () => {},
  } = opts;

  const referenced = referencedNodeIds(map, fileKey);
  const { sets, standalone, specimenIds } = buildSkeleton(inventory, referenced);

  const specimens: Record<string, KitSpecimen> = {};
  if (client && specimenIds.length) {
    for (let i = 0; i < specimenIds.length; i += BATCH) {
      const chunk = specimenIds.slice(i, i + BATCH);
      const res = await client.getFileNodes(fileKey, chunk, { depth: 1 });
      for (const id of chunk) {
        const doc = res.nodes[id]?.document;
        if (doc) specimens[id] = { name: doc.name, type: doc.type };
      }
    }
  } else if (specimenIds.length && previous?.specimens) {
    // Preserve a previously generated specimen vocabulary for token-free local
    // rebuilds; an authenticated run always repopulates it from the source.
    for (const id of specimenIds) {
      const carried = previous.specimens[id];
      if (carried) specimens[id] = carried;
    }
  }

  const allPropertyInstances = inventory.pages.flatMap(
    (page) => page.propertyInstances,
  );

  let propertied = 0;
  let configuredInstances = 0;
  const setIds = Object.keys(sets);
  if (client && setIds.length) {
    for (let i = 0; i < setIds.length; i += BATCH) {
      const chunk = setIds.slice(i, i + BATCH);
      const res = await client.getFileNodes(fileKey, chunk, { depth: 1 });
      for (const id of chunk) {
        const set = sets[id];
        const definitions =
          res.nodes[id]?.document?.componentPropertyDefinitions;
        if (!set || !definitions) continue;
        const added = attachProperties(set, definitions, allPropertyInstances);
        propertied += added.properties;
        configuredInstances += added.instances;
      }
    }
  } else if (!client) {
    log("No client supplied — writing the index without component properties.");
  }

  const variants = Object.values(sets).reduce(
    (n, s) => n + s.variants.length,
    0,
  );
  const renderAliases = Object.values(sets).reduce(
    (n, s) => n + s.variants.filter((v) => v.renderId).length,
    0,
  );

  return {
    index: { fileKey, generatedBy, sets, standalone, specimens },
    stats: {
      sets: setIds.length,
      variants,
      renderAliases,
      standalone: Object.keys(standalone).length,
      specimens: Object.keys(specimens).length,
      propertied,
      configuredInstances,
    },
  };
}
