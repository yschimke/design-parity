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

import type { Redline } from "@design-parity/catalog-export";

import { redlineLabel, redlineRgb, severityRgb } from "./annotations.js";
import { buildDesignMap } from "./designMap.js";
import { REFERENCE_PAGE, type ParityDirection } from "./direction.js";
import type { ImportPlan, PlannedComponent, PlannedGroup, PlannedImage } from "./plan.js";
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
  /** A designer-owned Figma spec frame — seeded from code once, never reconciled. */
  spec: "spec",
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
  /** Present on a page node: the user's current on-canvas selection (real Figma API). */
  selection?: readonly FigmaNode[];
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
  /** A Figma COMPONENT node — one variant of a component set (real Figma API). */
  createComponent(): FigmaNode;
  /** Combine components into a variant COMPONENT_SET under `parent` (real Figma API). */
  combineAsVariants(components: FigmaNode[], parent: FigmaNode): FigmaNode;
  /** Parse an SVG string into a frame of vector nodes, added to the current page (real Figma API). */
  createNodeFromSvg(svg: string): FigmaNode;
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
  /**
   * Design-led, unconfirmed: nothing was written — the summary describes what a
   * confirmed run *would* do. The UI surfaces a confirm affordance and re-runs
   * with {@link ImportOptions.confirmDesignLed} set.
   */
  pendingConfirmation?: boolean;
}

/** How an import should behave, beyond the plan itself. */
export interface ImportOptions {
  /**
   * Who owns the source of truth. **code-led** (default): the importer owns the
   * catalog page and builds/reconciles it directly. **design-led**: renders are
   * a comparison reference only — they go onto a dedicated
   * `Code renders (reference)` page and the importer refuses to write until the
   * caller confirms (so it never restructures a designer-owned file unasked).
   */
  direction?: ParityDirection;
  /** Design-led writes require this to be `true`; otherwise the run is a dry run. */
  confirmDesignLed?: boolean;
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
  opts: ImportOptions = {},
): Promise<ImportResult> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const bytesByPath = new Map(images.map((i) => [i.path, i.bytes]));
  const direction: ParityDirection = opts.direction ?? "code-led";
  const pageName =
    direction === "design-led" ? REFERENCE_PAGE : `${plan.title} — Catalog`;

  // Design-led: never write a designer-owned file without an explicit go-ahead —
  // report what a confirmed run would do and stop.
  if (direction === "design-led" && !opts.confirmDesignLed) {
    return dryRun(figma, plan, bytesByPath, pageName);
  }

  // Code-led with a screen graph or theme foundations: a structured, multi-page
  // layout (Themes/Tokens page + one page per screen + a catalog remainder).
  // (Design-led stays a single reference page — its renders are comparison-only.)
  if (direction === "code-led" && (planHasThemes(plan) || (plan.screens?.length ?? 0) > 0)) {
    return buildScopes(figma, plan, bytesByPath, direction);
  }

  const existing = findCatalogRoot(figma, plan.system, direction, "catalog");
  if (existing) {
    return reconcileInto(figma, existing.page, existing.root, plan, bytesByPath);
  }
  return buildFresh(figma, plan, bytesByPath, direction, pageName);
}

/**
 * Locate an existing catalog root frame stamped for `system` **in this mode**,
 * with its page. A design-led reference board and a code-led catalog board are
 * kept distinct, so one mode never reconciles into the other's board. Boards
 * stamped before modes existed carry no `mode` and read as `code-led`.
 */
function findCatalogRoot(
  figma: FigmaApi,
  system: string,
  mode: ParityDirection,
  scope: string,
): { page: FigmaNode; root: FigmaNode } | undefined {
  for (const page of figma.root.children) {
    if (isCatalogRootFor(system, mode, scope)(page)) return { page, root: page };
    const match = descendants(page, isCatalogRootFor(system, mode, scope)).find(Boolean);
    if (match) return { page, root: match };
  }
  return undefined;
}

function isCatalogRootFor(system: string, mode: ParityDirection, scope: string): (n: FigmaNode) => boolean {
  return (n) =>
    n.getSharedPluginData(STAMP, "role") === ROLE.root &&
    n.getSharedPluginData(STAMP, "system") === system &&
    (n.getSharedPluginData(STAMP, "mode") || "code-led") === mode &&
    // Boards from before per-screen scopes carry no `scope` and read as "catalog".
    (n.getSharedPluginData(STAMP, "scope") || "catalog") === scope;
}

/**
 * Design-led dry run: read-only. Reports how many renders a confirmed import
 * would place / update on the reference page, without touching the scene.
 */
function dryRun(
  figma: FigmaApi,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
  pageName: string,
): ImportResult {
  const existing = findCatalogRoot(figma, plan.system, "design-led", "catalog");
  let action: string;
  if (existing) {
    const existingCards: ExistingCard[] = [];
    for (const node of descendants(existing.root, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.card)) {
      const componentId = node.getSharedPluginData(STAMP, "componentId");
      if (componentId) existingCards.push({ componentId, nodeId: node.id });
    }
    const plannedIds = plan.groups.flatMap((g) => g.components.map((c) => c.componentId));
    const { update, add, stale } = reconcile(existingCards, plannedIds);
    const staleNote = stale.length > 0 ? `, tag ${stale.length} stale` : "";
    action = `update ${update.length}, add ${add.length}${staleNote}`;
  } else {
    const renders = plan.groups.reduce(
      (n, g) => n + g.components.reduce((m, c) => m + c.images.filter((i) => bytesByPath.has(i.path)).length, 0),
      0,
    );
    action = `import ${renders} render${renders === 1 ? "" : "s"} across ${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}`;
  }
  const designMap = emitDesignMap(figma, plan, {});
  const summary = `Design-led (Figma owns this file): confirm to ${action} on the "${pageName}" page. Nothing written yet.`;
  return {
    summary,
    designMap: designMap.map,
    fileKeyKnown: designMap.fileKeyKnown,
    reconciled: false,
    pendingConfirmation: true,
  };
}

/**
 * Create a fresh page + stamped catalog root for one scope (the flat catalog, or
 * one screen). `rootName` labels the root frame; `scope` distinguishes screen
 * boards from the catalog board so a re-import reconciles the right one.
 */
function createScopePage(
  figma: FigmaApi,
  system: string,
  direction: ParityDirection,
  scope: string,
  pageName: string,
  rootName: string,
): FigmaNode {
  const page = figma.createPage();
  page.name = pageName;
  figma.currentPage = page;

  const root = figma.createFrame();
  root.name = rootName;
  root.layoutMode = "VERTICAL";
  root.itemSpacing = GROUP_GAP;
  root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = PAD;
  root.primaryAxisSizingMode = "AUTO";
  root.counterAxisSizingMode = "AUTO";
  stamp(root, ROLE.root, { system, mode: direction, scope });
  page.appendChild(root);
  root.appendChild(title(figma, rootName, 32));
  return root;
}

/** Build the section/card tree for `groups` under a fresh `root`. */
/**
 * Renders one component into its **reconcile unit**: a node stamped
 * `role=card` + `componentId`, whose `role=image` descendants carry the renders
 * (so {@link refreshCardImages} can update either shape in place). Two shapes:
 * {@link renderCard} (a flat image row) and {@link renderComponentSet} (a native
 * Figma component set). Returns the unit + how many renders it placed.
 */
type RenderUnit = (
  figma: FigmaApi,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
) => { row: FigmaNode; placedImages: number };

function buildCardsInto(
  figma: FigmaApi,
  root: FigmaNode,
  groups: readonly PlannedGroup[],
  bytesByPath: Map<string, Uint8Array>,
  renderUnit: RenderUnit = renderCard,
): { placed: number; nodeIds: Record<string, string> } {
  let placed = 0;
  // componentId → the card frame the plugin placed, for correspondence authoring.
  const nodeIds: Record<string, string> = {};
  for (const group of groups) {
    const section = renderSection(figma, group.name);
    for (const component of group.components) {
      const { row, placedImages } = renderUnit(figma, component, bytesByPath);
      if (placedImages > 0) {
        placed += placedImages;
        nodeIds[component.componentId] = row.id;
        section.appendChild(row);
      }
    }
    root.appendChild(section);
  }
  return { placed, nodeIds };
}

/** Fresh import: a new page with the whole catalog. Every node is stamped. */
async function buildFresh(
  figma: FigmaApi,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
  direction: ParityDirection,
  pageName: string,
): Promise<ImportResult> {
  const root = createScopePage(figma, plan.system, direction, "catalog", pageName, plan.title);
  const { placed, nodeIds } = buildCardsInto(figma, root, plan.groups, bytesByPath);

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
/**
 * Reconcile the cards for `groups` onto an existing stamped `root`: matched cards
 * are refreshed in place (same node id), newcomers are added into their group
 * section, and cards gone from `groups` are tagged `stale` — never deleted.
 * Unstamped nodes (a designer's own content) are never touched. Returns the
 * counts + the componentId → node-id map for the correspondence.
 */
function reconcileCardsInto(
  figma: FigmaApi,
  root: FigmaNode,
  groups: readonly PlannedGroup[],
  bytesByPath: Map<string, Uint8Array>,
  renderUnit: RenderUnit = renderCard,
): { updated: number; added: number; stale: number; nodeIds: Record<string, string> } {
  // Index the board's stamped cards by componentId (first stamp wins).
  const cardNodes = new Map<string, FigmaNode>();
  const existingCards: ExistingCard[] = [];
  for (const node of descendants(root, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.card)) {
    const componentId = node.getSharedPluginData(STAMP, "componentId");
    if (!componentId) continue;
    existingCards.push({ componentId, nodeId: node.id });
    if (!cardNodes.has(componentId)) cardNodes.set(componentId, node);
  }

  // Index the incoming groups: componentId → its component + owning group.
  const planned = new Map<string, { component: PlannedComponent; group: string }>();
  for (const group of groups) {
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
    const { row, placedImages } = renderUnit(figma, component, bytesByPath);
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

  return { updated, added, stale: actions.stale.length, nodeIds };
}

/** Single-board reconcile: the whole plan onto the one catalog `root`. */
async function reconcileInto(
  figma: FigmaApi,
  page: FigmaNode,
  root: FigmaNode,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
): Promise<ImportResult> {
  figma.currentPage = page;
  const { updated, added, stale, nodeIds } = reconcileCardsInto(figma, root, plan.groups, bytesByPath);
  figma.viewport.scrollAndZoomIntoView([root]);

  const designMap = emitDesignMap(figma, plan, nodeIds);
  const staleNote = stale > 0 ? `, ${stale} tagged stale` : "";
  const summary = `Reconciled ${plan.title}: ${updated} updated, ${added} added${staleNote}.`;
  return { summary, designMap: designMap.map, fileKeyKnown: designMap.fileKeyKnown, reconciled: true };
}

/**
 * Code-led per-screen import: one page per main screen (its card + related
 * components) plus a catalog page for everything not on a screen. Each page is
 * its own reconcile scope, so a re-import refreshes each in place. Screen /
 * related ids that name no rendered component are skipped (the generator warns).
 */
/** The dedicated page for the theme-foundation showcases + token variables. */
const TOKENS_PAGE = "Themes / Tokens";

/**
 * A theme-foundation component — the `Theme/*` showcases the catalogs emit (or
 * anything in a "Themes" group). These route to the {@link TOKENS_PAGE} instead
 * of the catalog/screen pages.
 */
function isThemeComponent(componentId: string, group: string): boolean {
  return componentId.startsWith("Theme/") || group === "Themes";
}

/** Whether the plan carries any theme-foundation components for the Tokens page. */
function planHasThemes(plan: ImportPlan): boolean {
  return plan.groups.some((g) => g.components.some((c) => isThemeComponent(c.componentId, g.name)));
}

/**
 * Code-led multi-page import: a `Themes / Tokens` page for the theme
 * foundations, one page per main screen (+ related), and a catalog page for the
 * remainder. Each page is its own reconcile scope. Used whenever the plan has a
 * screen graph or theme components; a plain catalog with neither stays a single
 * flat page (see {@link buildFresh}).
 */
async function buildScopes(
  figma: FigmaApi,
  plan: ImportPlan,
  bytesByPath: Map<string, Uint8Array>,
  direction: ParityDirection,
): Promise<ImportResult> {
  const byId = new Map<string, PlannedComponent>();
  for (const group of plan.groups) {
    for (const component of group.components) byId.set(component.componentId, component);
  }

  const used = new Set<string>();
  const scopes: Array<{
    scope: string;
    pageName: string;
    rootName: string;
    groups: PlannedGroup[];
    renderUnit?: RenderUnit;
    /** Seed a designer-owned Figma-spec header from this component (screen pages). */
    specSeed?: PlannedComponent;
  }> = [];

  // Tokens scope first: the theme-foundation showcases get their own
  // `Themes / Tokens` page (the native Figma variable collection, created once
  // below, is the machine-readable half of that page).
  const themeGroups = plan.groups
    .map((group) => ({
      name: group.name,
      components: group.components.filter((c) => isThemeComponent(c.componentId, group.name)),
    }))
    .filter((group) => group.components.length > 0);
  if (themeGroups.length > 0) {
    for (const group of themeGroups) {
      for (const component of group.components) used.add(component.componentId);
    }
    scopes.push({ scope: "tokens", pageName: TOKENS_PAGE, rootName: TOKENS_PAGE, groups: themeGroups });
  }

  for (const screen of plan.screens ?? []) {
    const components: PlannedComponent[] = [];
    for (const id of [screen.id, ...(screen.related ?? [])]) {
      const component = byId.get(id);
      if (!component) continue; // undeclared/unrendered — generator already warned
      components.push(component);
      used.add(id);
    }
    if (components.length === 0) continue;
    const name = screen.title ?? screen.id;
    // Seed the Figma-spec header from the main screen's render (the first id).
    const specSeed = byId.get(screen.id);
    scopes.push({
      scope: `screen:${screen.id}`,
      pageName: name,
      rootName: name,
      groups: [{ name, components }],
      renderUnit: renderScreenCard,
      ...(specSeed ? { specSeed } : {}),
    });
  }

  // Remainder: everything not a theme or on a screen becomes the component
  // library — a `Components` page where each component is a native Figma
  // component set (its states/themes/sizes become variant properties).
  const remainder = plan.groups
    .map((group) => ({ name: group.name, components: group.components.filter((c) => !used.has(c.componentId)) }))
    .filter((group) => group.components.length > 0);
  if (remainder.length > 0) {
    scopes.push({
      scope: "components",
      pageName: "Components",
      rootName: "Components",
      groups: remainder,
      renderUnit: renderComponentSet,
    });
  }

  const nodeIds: Record<string, string> = {};
  let updated = 0;
  let added = 0;
  let stale = 0;
  let placed = 0;
  let anyReconciled = false;
  let anyFresh = false;
  const roots: FigmaNode[] = [];
  for (const { scope, pageName, rootName, groups, renderUnit, specSeed } of scopes) {
    const existing = findCatalogRoot(figma, plan.system, direction, scope);
    if (existing) {
      figma.currentPage = existing.page;
      const r = reconcileCardsInto(figma, existing.root, groups, bytesByPath, renderUnit);
      updated += r.updated;
      added += r.added;
      stale += r.stale;
      Object.assign(nodeIds, r.nodeIds);
      roots.push(existing.root);
      anyReconciled = true;
    } else {
      const root = createScopePage(figma, plan.system, direction, scope, pageName, rootName);
      // The Figma-spec header goes first on a screen page, before the code
      // renders — seeded from code once, then owned by the designer.
      if (specSeed) {
        const spec = makeSpecFrame(figma, specSeed, bytesByPath);
        if (spec) root.appendChild(spec);
      }
      const r = buildCardsInto(figma, root, groups, bytesByPath, renderUnit);
      placed += r.placed;
      Object.assign(nodeIds, r.nodeIds);
      roots.push(root);
      anyFresh = true;
    }
  }

  // Variables live once at the file level: create them only on a first, all-fresh
  // import (a reconcile means the collection already exists — don't duplicate it).
  let variableNote = "";
  if (plan.collection && anyFresh && !anyReconciled) {
    const n = createVariableCollection(figma, plan.collection);
    variableNote = `, ${n} variables`;
  }

  if (roots.length > 0) figma.viewport.scrollAndZoomIntoView(roots);

  const designMap = emitDesignMap(figma, plan, nodeIds);
  const pageCount = scopes.length;
  const pageNote = `${pageCount} page${pageCount === 1 ? "" : "s"}`;
  const summary = anyReconciled
    ? `Reconciled ${plan.title} across ${pageNote}: ${updated} updated, ${added} added${stale > 0 ? `, ${stale} tagged stale` : ""}${variableNote}.`
    : `Imported ${placed} render${placed === 1 ? "" : "s"} across ${pageNote}${variableNote}.`;
  return { summary, designMap: designMap.map, fileKeyKnown: designMap.fileKeyKnown, reconciled: anyReconciled };
}

/** Swap the fills of a card's existing image cells against the new plan bytes. */
function refreshCardImages(
  figma: FigmaApi,
  card: FigmaNode,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): boolean {
  const cells = descendants(card, (n) => n.getSharedPluginData(STAMP, "role") === ROLE.image);
  // Refresh both lanes in placement order: the ideal renders, then the wireframe
  // comparison renders. A flat card has only the ideal cells; a screen card has
  // both — `Math.min` below refreshes exactly the cells that exist.
  const available = [...component.images, ...(component.compare ?? [])].filter((img) => bytesByPath.has(img.path));
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
 * The **Figma spec** frame that heads a screen page: a designer-owned starting
 * point, seeded once from the screen's code render. Stamped `role=spec` (not
 * `role=card`), so the reconcile — which only ever touches `role=card` /
 * `role=image` nodes — never overwrites it: the designer takes it over and the
 * code renders below stay the live comparison. Returns `undefined` when the
 * seed component has no render (nothing to seed from).
 */
function makeSpecFrame(
  figma: FigmaApi,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): FigmaNode | undefined {
  const seed = component.images.find((image) => bytesByPath.has(image.path));
  if (!seed) return undefined;

  const frame = figma.createFrame();
  frame.name = `Figma spec — ${component.componentId}`;
  frame.layoutMode = "VERTICAL";
  frame.itemSpacing = GAP;
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.fills = [];
  stamp(frame, ROLE.spec, { componentId: component.componentId });
  frame.appendChild(title(figma, `Figma spec — ${component.componentId}`, 20));

  const caption = figma.createText();
  caption.fontName = { family: "Inter", style: "Regular" };
  caption.fontSize = 12;
  caption.characters = "Seeded from the code render — designer owns this; the code renders below stay the live comparison.";
  frame.appendChild(caption);

  const hash = figma.createImage(bytesByPath.get(seed.path)!).hash;
  const cell = figma.createFrame();
  cell.name = `${component.componentId} — spec (seed)`;
  cell.resize(seed.width, seed.height);
  cell.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
  // Deliberately NOT stamped role=image: reconcile must never refresh the spec.
  frame.appendChild(cell);
  return frame;
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
      drawRedlines(figma, cell, component.redlines);
    }
    row.appendChild(cell);
    placedImages += 1;
  });
  return { row, placedImages };
}

/** Draw the spacing redline (box + spec label) overlay onto a render cell. */
function drawRedlines(figma: FigmaApi, cell: FigmaNode, redlines: readonly Redline[]): void {
  for (const r of redlines) {
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

/**
 * A screen-page card: the exact **code render** (lane c, via {@link renderCard})
 * followed by the **wireframe** comparison lane (lane b) — the component's layout
 * renders (`compare`), placed as further `role=image` cells in the same row.
 * Both lanes are `role=image` in placement order (code, then wireframe), which is
 * exactly the order {@link refreshCardImages} refreshes, so a re-import updates
 * both. Together with the page's {@link makeSpecFrame} header (lane a), this is
 * the figma / wireframe / PNG diff the per-screen page is for.
 */
function renderScreenCard(
  figma: FigmaApi,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): { row: FigmaNode; placedImages: number } {
  const { row, placedImages } = renderCard(figma, component, bytesByPath);
  if (placedImages === 0) return { row, placedImages };

  let placed = placedImages;
  (component.compare ?? []).forEach((image, i) => {
    const bytes = bytesByPath.get(image.path);
    if (!bytes) return;
    const hash = figma.createImage(bytes).hash;
    const cell = figma.createFrame();
    cell.name = `${component.componentId} — wireframe · ${image.key}`;
    cell.resize(image.width, image.height);
    cell.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
    stamp(cell, ROLE.image, { componentId: component.componentId });
    // The wireframe's natural overlay: the spacing redlines, on the first cell.
    if (i === 0 && component.compareRedlines) {
      drawRedlines(figma, cell, component.compareRedlines);
    }
    row.appendChild(cell);
    placed += 1;
  });
  return { row, placedImages: placed };
}

/**
 * The variant-property name Figma parses a component's axes from, e.g.
 * `state=default, theme=light, size=compact`. Figma reads variant properties
 * straight off each COMPONENT's name inside a set.
 */
function variantName(image: PlannedImage): string {
  const parts: string[] = [`state=${image.state ?? "default"}`];
  if (image.theme) parts.push(`theme=${image.theme}`);
  if (image.size) parts.push(`size=${image.size}`);
  return parts.join(", ");
}

/**
 * Render one component as a native Figma **component set**: one COMPONENT per
 * render (named with its variant properties) combined into a set. The set is the
 * reconcile unit (`role=card`), its variant components the `role=image` cells —
 * so {@link refreshCardImages} refreshes them in place on a re-import just like a
 * flat card. Overlays aren't drawn here; the set is the reusable library form.
 */
function renderComponentSet(
  figma: FigmaApi,
  component: PlannedComponent,
  bytesByPath: Map<string, Uint8Array>,
): { row: FigmaNode; placedImages: number } {
  const variants: FigmaNode[] = [];
  for (const image of component.images) {
    const bytes = bytesByPath.get(image.path);
    if (!bytes) continue;
    const hash = figma.createImage(bytes).hash;
    const variant = figma.createComponent();
    variant.name = variantName(image);
    variant.resize(image.width, image.height);
    variant.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
    stamp(variant, ROLE.image, { componentId: component.componentId });
    variants.push(variant);
  }
  if (variants.length === 0) {
    // No bytes for this component — hand back an empty frame the caller drops.
    return { row: figma.createFrame(), placedImages: 0 };
  }
  // Combine into a set under the current page; the caller reparents it into its
  // group section (appendChild moves it), exactly like a flat card.
  const set = figma.combineAsVariants(variants, figma.currentPage);
  set.name = component.componentId;
  stamp(set, ROLE.card, { componentId: component.componentId });
  return { row: set, placedImages: variants.length };
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
