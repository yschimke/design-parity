/**
 * The main-thread scene builder — the plugin logic that turns an
 * {@link ImportPlan} + fetched PNG bytes into a Figma canvas.
 *
 * It takes the Figma scene API as an **injected** {@link FigmaApi} parameter
 * rather than reaching for the `figma` global, so it runs — and is asserted —
 * headlessly in tests against a fake API (`test/fakeFigma.ts`), catching scene
 * mistakes (wrong calls, ordering, null handling) before the plugin ever loads
 * in real Figma. `figma/code.ts` is the thin bootstrap that passes the real
 * `figma` in. Only genuinely runtime-specific behaviour (font metrics, image
 * decoding) is left to the manual smoke test.
 *
 * **Identity, not position.** Every node the builder creates is stamped with
 * shared plugin data ({@link STAMP}) recording its role — and, on cards/images,
 * the catalog `componentId`. That makes a re-import a **reconcile** rather than a
 * delete-and-rebuild: {@link applyImport} finds the existing catalog for the
 * system by its `catalog-root` stamp and updates the matched cards in place
 * (keeping their node ids, positions, and any designer edits), adds newcomers,
 * and tags cards gone from the catalog `stale` — it never regenerates the board.
 * The pure decision of what to update/add/stale lives in {@link reconcile}.
 *
 * `FigmaApi` is a hand-written structural subset of Figma's `PluginAPI` — just
 * the members this builder uses. The real `figma` satisfies it (the bootstrap
 * bridges with one cast); the fake implements it exactly.
 */
import type { FigmaVariableCollection, FigmaVariableType } from "@design-parity/catalog-export/figma";

import { redlineLabel, redlineRgb, severityRgb } from "./annotations.js";
import { buildDesignMap } from "./designMap.js";
import type { ImportPlan, PlannedComponent, PlannedGroup } from "./plan.js";
import { reconcile, type ExistingCard } from "./reconcile.js";
import type { DesignMap } from "@design-parity/core";

const PAD = 48;
const GAP = 24;
const GROUP_GAP = 64;

/**
 * The shared-plugin-data namespace every stamp lives under. Invisible to a
 * designer, durable across moves/renames/regroups — the anchor a re-import
 * matches on. Keep in step with {@link ROLE}.
 */
export const STAMP = "designParity";

/** The `role` values stamped onto created nodes, by structural position. */
export const ROLE = {
  root: "catalog-root",
  group: "group",
  card: "card",
  image: "image",
} as const;

/** A colour or scalar assigned to a Figma variable, per mode. */
export interface FigmaRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export type FigmaVariableValue = FigmaRgba | number | string | boolean;

/** A paint the builder assigns to a node's `fills` / `strokes`. */
export type FigmaPaint =
  | { type: "SOLID"; color: { r: number; g: number; b: number } }
  | { type: "IMAGE"; scaleMode: "FILL"; imageHash: string };

/**
 * One scene node. A single permissive shape stands in for frame / rectangle /
 * text nodes — each uses a subset of these members, mirroring how the real
 * typed nodes structurally provide them.
 */
export interface FigmaNode {
  id: string;
  name: string;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  dashPattern?: number[];
  cornerRadius?: number;
  x?: number;
  y?: number;
  fontName?: { family: string; style: string };
  fontSize?: number;
  characters?: string;
  /** Present on container nodes (pages, frames); used to walk for reconcile. */
  children?: readonly FigmaNode[];
  appendChild(child: FigmaNode): void;
  resize(width: number, height: number): void;
  /** Stamp durable, invisible identity data under a namespace (real Figma API). */
  setSharedPluginData(namespace: string, key: string, value: string): void;
  /** Read an identity stamp; returns `""` when unset (real Figma API). */
  getSharedPluginData(namespace: string, key: string): string;
}

export interface FigmaVariableCollectionNode {
  modes: { modeId: string }[];
  defaultModeId: string;
  renameMode(modeId: string, name: string): void;
  addMode(name: string): string;
}

export interface FigmaVariableNode {
  setValueForMode(modeId: string, value: FigmaVariableValue): void;
}

/** The subset of Figma's `PluginAPI` the scene builder depends on. */
export interface FigmaApi {
  fileKey?: string;
  /** The document node; its `children` are the file's pages (real Figma API). */
  root: { children: readonly FigmaNode[] };
  currentPage: FigmaNode;
  loadFontAsync(font: { family: string; style: string }): Promise<void>;
  createPage(): FigmaNode;
  createFrame(): FigmaNode;
  createRectangle(): FigmaNode;
  createText(): FigmaNode;
  createImage(bytes: Uint8Array): { hash: string };
  variables: {
    createVariableCollection(name: string): FigmaVariableCollectionNode;
    createVariable(
      name: string,
      collection: FigmaVariableCollectionNode,
      type: FigmaVariableType,
    ): FigmaVariableNode;
  };
  viewport: { scrollAndZoomIntoView(nodes: FigmaNode[]): void };
}

/** Bytes the UI fetched for one planned image, keyed by its bundle path. */
export interface FetchedImage {
  path: string;
  bytes: Uint8Array;
}

/** The outcome of an import: a human summary plus the correspondence to export. */
export interface ImportResult {
  summary: string;
  designMap: DesignMap;
  fileKeyKnown: boolean;
  /** Whether this import reconciled an existing board (vs built a fresh one). */
  reconciled: boolean;
}

function stamp(node: FigmaNode, role: string, extra?: Record<string, string>): void {
  node.setSharedPluginData(STAMP, "role", role);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      node.setSharedPluginData(STAMP, key, value);
    }
  }
}

/** Depth-first descendants of `node` matching `pred` (excludes `node` itself). */
function descendants(node: FigmaNode, pred: (n: FigmaNode) => boolean): FigmaNode[] {
  const out: FigmaNode[] = [];
  const walk = (n: FigmaNode): void => {
    for (const child of n.children ?? []) {
      if (pred(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

/**
 * Build (or refresh) the catalog for a plan + image bytes — pure given the
 * injected {@link FigmaApi}. If a stamped catalog for this system already exists
 * in the file it is reconciled in place; otherwise a fresh page is built. Either
 * way returns the summary line and the emitted `design-map.json`.
 */
export async function applyImport(
  figma: FigmaApi,
  plan: ImportPlan,
  images: FetchedImage[],
): Promise<ImportResult> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const bytesByPath = new Map(images.map((i) => [i.path, i.bytes]));

  const existing = findCatalogRoot(figma, plan.system);
  if (existing) {
    return reconcileInto(figma, existing.page, existing.root, plan, bytesByPath);
  }
  return buildFresh(figma, plan, bytesByPath);
}

/** Locate an existing catalog root frame stamped for `system`, with its page. */
function findCatalogRoot(
  figma: FigmaApi,
  system: string,
): { page: FigmaNode; root: FigmaNode } | undefined {
  for (const page of figma.root.children) {
    const match = descendants(page, isCatalogRootFor(system)).find(Boolean);
    if (match) return { page, root: match };
    if (isCatalogRootFor(system)(page)) return { page, root: page };
  }
  return undefined;
}

function isCatalogRootFor(system: string): (n: FigmaNode) => boolean {
  return (n) =>
    n.getSharedPluginData(STAMP, "role") === ROLE.root &&
    n.getSharedPluginData(STAMP, "system") === system;
}

/** Fresh import: a new page with the whole catalog. Every node is stamped. */
async function buildFresh(
  figma: FigmaApi,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
): Promise<ImportResult> {
  const page = figma.createPage();
  page.name = `${plan.title} — Catalog`;
  figma.currentPage = page;

  const root = figma.createFrame();
  root.name = plan.title;
  root.layoutMode = "VERTICAL";
  root.itemSpacing = GROUP_GAP;
  root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = PAD;
  root.primaryAxisSizingMode = "AUTO";
  root.counterAxisSizingMode = "AUTO";
  stamp(root, ROLE.root, { system: plan.system });
  page.appendChild(root);
  root.appendChild(title(figma, plan.title, 32));

  let placed = 0;
  // componentId → the card frame the plugin placed, for correspondence authoring.
  const nodeIds: Record<string, string> = {};
  for (const group of plan.groups) {
    const section = renderSection(figma, group.name);
    for (const component of group.components) {
      const { row, placedImages } = renderCard(figma, component, bytesByPath);
      if (placedImages > 0) {
        placed += placedImages;
        nodeIds[component.componentId] = row.id;
        section.appendChild(row);
      }
    }
    root.appendChild(section);
  }

  let variableNote = "";
  if (plan.collection) {
    const n = createVariableCollection(figma, plan.collection);
    variableNote = `, ${n} variables`;
  }

  figma.viewport.scrollAndZoomIntoView([root]);

  const designMap = emitDesignMap(figma, plan, nodeIds);
  const groupNote = `${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}`;
  const greenlineNote =
    plan.greenlineCount > 0 ? `, ${plan.greenlineCount} a11y greenlines` : "";
  const redlineNote =
    plan.redlineCount > 0 ? `, ${plan.redlineCount} layout redlines` : "";
  const summary = `Imported ${placed} render${placed === 1 ? "" : "s"} across ${groupNote}${greenlineNote}${redlineNote}${variableNote}.`;
  return { summary, designMap: designMap.map, fileKeyKnown: designMap.fileKeyKnown, reconciled: false };
}

/**
 * Reconcile the incoming plan onto an existing stamped board: matched cards are
 * refreshed in place (same node id), newcomers are added into their group, and
 * cards gone from the catalog are tagged `stale` — never deleted. Unstamped
 * nodes (a designer's own content) are never touched.
 */
async function reconcileInto(
  figma: FigmaApi,
  page: FigmaNode,
  root: FigmaNode,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
): Promise<ImportResult> {
  figma.currentPage = page;

  // Index the board's stamped cards by componentId (first stamp wins).
  const cardNodes = new Map<string, FigmaNode>();
  const existingCards: ExistingCard[] = [];
  for (const node of descendants(root, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.card)) {
    const componentId = node.getSharedPluginData(STAMP, "componentId");
    if (!componentId) continue;
    existingCards.push({ componentId, nodeId: node.id });
    if (!cardNodes.has(componentId)) cardNodes.set(componentId, node);
  }

  // Index the incoming plan: componentId → its component + owning group.
  const planned = new Map<string, { component: PlannedComponent; group: string }>();
  for (const group of plan.groups) {
    for (const component of group.components) {
      planned.set(component.componentId, { component, group: group.name });
    }
  }

  const actions = reconcile(existingCards, [...planned.keys()]);
  const nodeIds: Record<string, string> = {};

  // Update: swap each existing image cell's fill against the new bytes, in order.
  let updated = 0;
  for (const componentId of actions.update) {
    const card = cardNodes.get(componentId)!;
    const { component } = planned.get(componentId)!;
    if (refreshCardImages(figma, card, component, bytesByPath)) updated += 1;
    card.setSharedPluginData(STAMP, "state", ""); // clear any prior stale mark
    nodeIds[componentId] = card.id;
  }

  // Add: render a new card into its group section (creating the section if new).
  let added = 0;
  const sections = new Map<string, FigmaNode>();
  for (const section of descendants(root, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.group)) {
    const name = section.getSharedPluginData(STAMP, "group") || section.name;
    if (!sections.has(name)) sections.set(name, section);
  }
  for (const componentId of actions.add) {
    const { component, group } = planned.get(componentId)!;
    const { row, placedImages } = renderCard(figma, component, bytesByPath);
    if (placedImages === 0) continue;
    let section = sections.get(group);
    if (!section) {
      section = renderSection(figma, group);
      root.appendChild(section);
      sections.set(group, section);
    }
    section.appendChild(row);
    nodeIds[componentId] = row.id;
    added += 1;
  }

  // Stale: tag in place, never delete. Prefix the name once so it reads as stale.
  for (const card of actions.stale) {
    const node = cardNodes.get(card.componentId);
    // A duplicate stale card shares its componentId with the update target, so
    // re-resolve by node id to tag the right one.
    const target =
      node && node.id === card.nodeId
        ? node
        : descendants(root, (n) => n.id === card.nodeId)[0];
    if (!target) continue;
    target.setSharedPluginData(STAMP, "state", "stale");
    if (!target.name.startsWith("(stale) ")) target.name = `(stale) ${target.name}`;
  }

  figma.viewport.scrollAndZoomIntoView([root]);

  const designMap = emitDesignMap(figma, plan, nodeIds);
  const staleNote = actions.stale.length > 0 ? `, ${actions.stale.length} tagged stale` : "";
  const summary = `Reconciled ${plan.title}: ${updated} updated, ${added} added${staleNote}.`;
  return { summary, designMap: designMap.map, fileKeyKnown: designMap.fileKeyKnown, reconciled: true };
}

/** Swap the fills of a card's existing image cells against the new plan bytes. */
function refreshCardImages(
  figma: FigmaApi,
  card: FigmaNode,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): boolean {
  const cells = descendants(card, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.image);
  const available = component.images.filter((img) => bytesByPath.has(img.path));
  let changed = false;
  const count = Math.min(cells.length, available.length);
  for (let i = 0; i < count; i++) {
    const bytes = bytesByPath.get(available[i]!.path)!;
    const hash = figma.createImage(bytes).hash;
    cells[i]!.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
    changed = true;
  }
  return changed;
}

/** A stamped section (group) frame with its heading. */
function renderSection(figma: FigmaApi, name: string): FigmaNode {
  const section = figma.createFrame();
  section.name = name;
  section.layoutMode = "VERTICAL";
  section.itemSpacing = GAP;
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.fills = [];
  stamp(section, ROLE.group, { group: name });
  section.appendChild(title(figma, name, 20));
  return section;
}

/**
 * Render one component's card (the horizontal row of image cells + overlays),
 * stamped with its identity. Returns the row node and how many renders it
 * placed (0 ⇒ the caller drops it, as before).
 */
function renderCard(
  figma: FigmaApi,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): { row: FigmaNode; placedImages: number } {
  const row = figma.createFrame();
  row.name = component.componentId;
  row.layoutMode = "HORIZONTAL";
  row.itemSpacing = GAP;
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "AUTO";
  row.fills = [];
  stamp(row, ROLE.card, { componentId: component.componentId });

  let placedImages = 0;
  component.images.forEach((image, i) => {
    const bytes = bytesByPath.get(image.path);
    if (!bytes) return;
    const hash = figma.createImage(bytes).hash;

    // A fixed-size frame holds the render plus, on the first image, the a11y
    // greenline overlay positioned in the render's own pixel space.
    const cell = figma.createFrame();
    cell.name = `${component.componentId} — ${image.key}`;
    cell.resize(image.width, image.height);
    cell.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
    stamp(cell, ROLE.image, { componentId: component.componentId });

    if (i === 0) {
      for (const g of component.greenlines) {
        if (!g.bounds) continue;
        const box = figma.createRectangle();
        box.name = `a11y (${g.severity}): ${g.message}`;
        box.x = g.bounds.x;
        box.y = g.bounds.y;
        box.resize(Math.max(1, g.bounds.width), Math.max(1, g.bounds.height));
        box.fills = [];
        box.strokes = [{ type: "SOLID", color: severityRgb(g.severity) }];
        box.strokeWeight = 2;
        cell.appendChild(box);
      }
      for (const r of component.redlines) {
        const label = redlineLabel(r);
        const box = figma.createRectangle();
        box.name = `layout: ${label || r.role || "node"}`;
        box.x = r.bounds.x;
        box.y = r.bounds.y;
        box.resize(Math.max(1, r.bounds.width), Math.max(1, r.bounds.height));
        box.fills = [];
        box.strokes = [{ type: "SOLID", color: redlineRgb() }];
        box.strokeWeight = 1;
        box.dashPattern = [4, 3];
        if (r.cornerRadius !== undefined) box.cornerRadius = r.cornerRadius;
        cell.appendChild(box);
        if (label) {
          const tag = figma.createText();
          tag.fontName = { family: "Inter", style: "Regular" };
          tag.fontSize = 9;
          tag.characters = label;
          tag.x = r.bounds.x + 2;
          tag.y = r.bounds.y + 2;
          tag.fills = [{ type: "SOLID", color: redlineRgb() }];
          cell.appendChild(tag);
        }
      }
    }
    row.appendChild(cell);
    placedImages += 1;
  });
  return { row, placedImages };
}

/** Emit the design-map correspondence (code componentId → placed frame). */
function emitDesignMap(
  figma: FigmaApi,
  plan: ImportPlan,
  nodeIds: Record<string, string>,
): { map: DesignMap; fileKeyKnown: boolean } {
  // The file key is null outside a saved file — fall back to a placeholder the
  // user fills in, rather than emitting an unparseable empty ref.
  const fileKey = figma.fileKey ?? "";
  const map = buildDesignMap(plan, { fileKey: fileKey || "FILE_KEY", nodeIds });
  return { map, fileKeyKnown: fileKey.length > 0 };
}

function createVariableCollection(
  figma: FigmaApi,
  spec: FigmaVariableCollection,
): number {
  const collection = figma.variables.createVariableCollection(spec.name);
  // Rename the auto-created first mode; add the rest.
  const modeEntries = Object.entries(spec.modes);
  const modeIds = new Map<string, string>();
  const [firstId, firstName] = modeEntries[0] ?? [spec.defaultModeId, "Value"];
  collection.renameMode(collection.modes[0]!.modeId, firstName);
  modeIds.set(firstId, collection.modes[0]!.modeId);
  for (const [id, name] of modeEntries.slice(1)) {
    modeIds.set(id, collection.addMode(name));
  }

  for (const variable of spec.variables) {
    const created = figma.variables.createVariable(
      variable.name,
      collection,
      variable.resolvedType,
    );
    for (const [modeKey, value] of Object.entries(variable.valuesByMode)) {
      const modeId = modeIds.get(modeKey) ?? collection.defaultModeId;
      created.setValueForMode(modeId, coerce(variable.resolvedType, value));
    }
  }
  return spec.variables.length;
}

function coerce(type: FigmaVariableType, value: string | number): FigmaVariableValue {
  if (type === "COLOR") return hexToRgba(String(value));
  if (type === "FLOAT") return Number(value);
  if (type === "BOOLEAN") return Boolean(value);
  return String(value);
}

/** `#rrggbb`(`aa`) → Figma 0–1 RGBA. Exported for the bootstrap's paint coercion. */
export function hexToRgba(input: string): FigmaRgba {
  const hex = input.replace(/^#/, "").trim();
  const full =
    hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function title(figma: FigmaApi, text: string, size: number): FigmaNode {
  const node = figma.createText();
  node.fontName = { family: "Inter", style: "Semi Bold" };
  node.fontSize = size;
  node.characters = text;
  return node;
}
