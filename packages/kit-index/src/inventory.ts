/**
 * Walking a design kit, page by page.
 *
 * A kit's node ids are not discoverable without API access — Figma's Dev Mode
 * MCP server exposes only the page a user is looking at, and Code Connect
 * (which would hand the mapping back directly) is gated behind a paid seat. So
 * the ids come from the REST API, and this is the walk that collects them.
 *
 * Two things make the walk worth doing at a depth a parity run never needs:
 *
 * 1. A component set the matcher never offered may be **missing** or merely
 *    **deeper than the walk reached**, and those call for opposite responses.
 *    Recording `deepest` per page makes the difference legible.
 * 2. Instances are only visible here. A definition renders at its property
 *    defaults; an instance renders at whatever someone chose, which is the only
 *    handle a property-shaped variant can be paired with.
 *
 * The result is a disposable artifact — big, regenerable, and the input to
 * {@link file://./build.ts | the index build}, which is the small committed one.
 */
import type {
  FigmaNodeDoc,
  FigmaRestClient,
} from "@design-parity/adapter-figma";
import { propertyName } from "@design-parity/adapter-figma";

import type {
  InventoryComponent,
  InventoryInstance,
  InventoryMappedRef,
  InventoryPage,
  KitInventory,
} from "./types.js";

/** How deep to descend a page by default. */
export const DEFAULT_WALK_DEPTH = 8;

/** Node ids per `/nodes` request when resolving already-mapped refs. */
const REF_BATCH = 20;

const radiusOf = (node: FigmaNodeDoc): number | string | null =>
  node.cornerRadius ??
  (Array.isArray(node.rectangleCornerRadii)
    ? node.rectangleCornerRadii.join("/")
    : null);

const round = (n: number | undefined): number => Math.round(n ?? 0);

/** What one page's walk found, before any filtering by reference. */
export interface PageWalk {
  components: InventoryComponent[];
  instances: InventoryInstance[];
  /** Deepest level reached — how much of the tree the `depth` bound bought. */
  deepest: number;
}

/**
 * Collect every component, component set and visible instance under `root`.
 *
 * Pure: no network, no filtering by what a design map references. Exported so
 * the classification below can be pinned against hand-built trees.
 *
 * A component set's variants are NOT recorded as separate components — they are
 * its `children`. A ref belongs on a variant rather than on the set, because a
 * set frame is a variant grid whose own geometry is an editor artifact.
 */
export function walkPage(root: FigmaNodeDoc): PageWalk {
  const components: InventoryComponent[] = [];
  const instances: InventoryInstance[] = [];
  let deepest = 0;

  const walk = (
    node: FigmaNodeDoc,
    trail: string[],
    level: number,
    hiddenAbove: boolean,
  ): void => {
    deepest = Math.max(deepest, level);
    const hidden = hiddenAbove || node.visible === false;

    if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") {
      components.push({
        name: node.name,
        id: node.id,
        type: node.type,
        level,
        hidden,
        w: round(node.absoluteBoundingBox?.width),
        h: round(node.absoluteBoundingBox?.height),
        radius: radiusOf(node),
        trail: trail.join(" / "),
        children: (node.children ?? []).map((v) => ({
          name: v.name,
          id: v.id,
          w: round(v.absoluteBoundingBox?.width),
          h: round(v.absoluteBoundingBox?.height),
          radius: radiusOf(v),
        })),
      });
      return;
    }

    if (node.type === "INSTANCE" && !hidden && node.componentId) {
      instances.push({
        id: node.id,
        componentId: node.componentId,
        name: node.name,
        // Unlike a component definition, an instance carries the values that
        // were actually chosen. Keep every non-variant property so the index
        // can use this instance as a render handle for a property-shaped
        // variant. VARIANT entries are dropped because the variant name
        // already carries them, and keeping both invites the two to disagree.
        properties: Object.fromEntries(
          Object.entries(node.componentProperties ?? {})
            .filter(([, v]) => v.type !== "VARIANT")
            .map(([k, v]) => [propertyName(k), { type: v.type, value: v.value }]),
        ),
        trail: trail.join(" / "),
        example: trail.some((part) => /\bexamples?\b/i.test(part)),
        w: round(node.absoluteBoundingBox?.width),
        h: round(node.absoluteBoundingBox?.height),
      });
    }

    for (const child of node.children ?? []) {
      walk(child, [...trail, node.name], level + 1, hidden);
    }
  };

  walk(root, [], 0, false);
  return { components, instances, deepest };
}

/**
 * Split a page's instances into the two kinds the index keeps.
 *
 * `renderInstances` stand in for definitions that cannot be exported at all
 * (a hidden set). `propertyInstances` are renderable alternatives to
 * definitions that CAN be exported but only at their defaults.
 *
 * The property instances are narrowed to sets the design map actually
 * references, because a kit page can hold hundreds of unrelated screen
 * instances and retaining all of them would turn a focused index into a second
 * copy of the document.
 */
export function classifyInstances(
  walk: PageWalk,
  referencedNodeIds: ReadonlySet<string>,
): { renderInstances: InventoryInstance[]; propertyInstances: InventoryInstance[] } {
  const hiddenVariants = new Set(
    walk.components
      .filter((c) => c.type === "COMPONENT_SET" && c.hidden)
      .flatMap((c) => c.children.map((v) => v.id)),
  );
  const referencedSetVariants = new Set(
    walk.components
      .filter(
        (c) =>
          c.type === "COMPONENT_SET" &&
          c.children.some((v) => referencedNodeIds.has(v.id)),
      )
      .flatMap((c) => c.children.map((v) => v.id)),
  );

  return {
    renderInstances: walk.instances.filter((i) =>
      hiddenVariants.has(i.componentId),
    ),
    propertyInstances: walk.instances.filter(
      (i) =>
        referencedSetVariants.has(i.componentId) &&
        Object.keys(i.properties).length > 0,
    ),
  };
}

export interface DumpInventoryOptions {
  client: FigmaRestClient;
  fileKey: string;
  /** How deep to descend each page. Defaults to {@link DEFAULT_WALK_DEPTH}. */
  depth?: number;
  /**
   * Node ids the design map already references. Property instances are kept
   * only for the sets these belong to; an empty set keeps none, which is the
   * right answer for a first run with no map yet.
   */
  referencedNodeIds?: ReadonlySet<string>;
  /** Refs to resolve back to their nodes, for a "what do we point at?" report. */
  mappedRefs?: { code: string; nodeId: string }[];
  /** Progress sink. Defaults to silent, so library use prints nothing. */
  log?: (message: string) => void;
}

/**
 * Walk every page of a kit and record what it contains.
 *
 * A page that fails is recorded with its error and the walk continues: one
 * unreadable page should cost that page, not the run. The client's own retry
 * policy has already dealt with the transient cases by the time an error
 * reaches here.
 */
export async function dumpInventory(
  opts: DumpInventoryOptions,
): Promise<KitInventory> {
  const {
    client,
    fileKey,
    depth = DEFAULT_WALK_DEPTH,
    referencedNodeIds = new Set<string>(),
    mappedRefs = [],
    log = () => {},
  } = opts;

  const file = await client.getFilePages(fileKey);
  const pages = file.document.children ?? [];
  log(`${pages.length} page(s) in ${fileKey}`);

  const inventory: InventoryPage[] = [];
  for (const [i, page] of pages.entries()) {
    let root: FigmaNodeDoc | undefined;
    try {
      const nodes = await client.getFileNodes(fileKey, [page.id], { depth });
      root = nodes.nodes[page.id]?.document;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`  page "${page.name}" (${page.id}) failed: ${message}`);
      inventory.push({
        page: page.name,
        pageId: page.id,
        deepest: 0,
        components: [],
        renderInstances: [],
        propertyInstances: [],
        error: message,
      });
      continue;
    }
    if (!root) {
      inventory.push({
        page: page.name,
        pageId: page.id,
        deepest: 0,
        components: [],
        renderInstances: [],
        propertyInstances: [],
        error: "no document in the /nodes response",
      });
      continue;
    }

    const walk = walkPage(root);
    const { renderInstances, propertyInstances } = classifyInstances(
      walk,
      referencedNodeIds,
    );
    log(
      `  [${i + 1}/${pages.length}] ${page.name} (${page.id}): ` +
        `${walk.components.length} component(s), ` +
        `${renderInstances.length} hidden-variant example(s), ` +
        `${propertyInstances.length} configured instance(s), ` +
        `deepest ${walk.deepest}`,
    );
    inventory.push({
      page: page.name,
      pageId: page.id,
      deepest: walk.deepest,
      components: walk.components,
      renderInstances,
      propertyInstances,
    });
  }

  const mapped: InventoryMappedRef[] = [];
  for (let i = 0; i < mappedRefs.length; i += REF_BATCH) {
    const batch = mappedRefs.slice(i, i + REF_BATCH);
    const res = await client.getFileNodes(
      fileKey,
      batch.map((r) => r.nodeId),
      { depth: 1 },
    );
    for (const ref of batch) {
      const doc = res.nodes[ref.nodeId]?.document;
      mapped.push({
        ...ref,
        found: Boolean(doc),
        name: doc?.name ?? null,
        type: doc?.type ?? null,
        hidden: doc?.visible === false,
        w: round(doc?.absoluteBoundingBox?.width),
        h: round(doc?.absoluteBoundingBox?.height),
        radius: doc ? radiusOf(doc) : null,
        children: (doc?.children ?? []).length,
      });
    }
  }

  return { fileKey, depth, pages: inventory, mapped };
}
