/**
 * Main-thread plugin entry — the only realm with the `figma` scene API.
 *
 * Thin bootstrap: wire the UI, and on an import message hand the real `figma`
 * plus the plan + fetched bytes to {@link applyImport}, which owns the scene
 * logic and is tested headlessly against a fake API (`src/scene.ts`,
 * `test/fakeFigma.ts`). The one `as unknown as FigmaApi` cast bridges Figma's
 * exhaustive `PluginAPI` to the structural subset the builder needs.
 */
import { applyImport, STAMP, type FetchedImage, type FigmaApi, type FigmaNode } from "../src/scene.js";
import {
  placeCatalogPng,
  placeCatalogSvg,
  type InsertSetCell,
  type InsertSize,
} from "../src/insert.js";
import type { FrameLayout, FrameRead } from "../src/spec.js";
import type { ParityDirection } from "../src/direction.js";
import {
  placeLiveRender,
  placeLiveSvg,
  planRefresh,
  refreshLiveRender,
  refreshLiveSvg,
} from "../src/live.js";
import { readRenderSource, stampRenderSource } from "../src/provenance.js";
import type { ImportPlan } from "../src/plan.js";
import { withRenderSize, type RenderSource } from "../src/render.js";
import type { PreviewSlots } from "../src/slots.js";
import { fillSlot, placeSlots } from "../src/structure.js";
import type {
  FigmaTextStyleSpec,
  FigmaVariableCollection,
} from "@design-parity/catalog-export/figma";
import {
  bindImportedTextStyles,
  bindImportedVariables,
  exposeCommonTextProperties,
  exposeTextProperties,
  preflightSvgFonts,
  promoteNativeContainers,
} from "./nativeSvg.js";

/** The message the UI posts once it has resolved the plan and all image bytes. */
interface ImportMessage {
  type: "import";
  plan: ImportPlan;
  images: FetchedImage[];
  /** Resolved parity direction; design-led writes also need `confirm`. */
  direction?: ParityDirection;
  /** User confirmed a design-led write (otherwise design-led is a dry run). */
  confirm?: boolean;
}

/** The override editor posts this once it has fetched one preview's live render. */
interface PlaceLiveMessage {
  type: "placeLive";
  /** The render request — stamped on the node as provenance for a later Refresh. */
  source: RenderSource;
  bytes: Uint8Array;
  /** The node name; defaults to the preview id. */
  name?: string;
}

/** The override editor posts this once it has fetched one preview's SVG export. */
interface PlaceLiveSvgMessage {
  type: "placeLiveSvg";
  /** The render request (format `svg`) — stamped as provenance. */
  source: RenderSource;
  /** The self-contained SVG text (raster crops already inlined by the serve host). */
  svg: string;
  /** The node name; defaults to the preview id. */
  name?: string;
}

/** The UI posts this to insert one picked catalog component as a raster (PNG). */
interface InsertPngMessage {
  type: "insertPng";
  bytes: Uint8Array;
  /** The node name (component + chosen axes). */
  name: string;
  /** The catalog `componentId`, stamped for identity. */
  componentId: string;
  /** The render's pixel size, so the frame matches the image. */
  size: InsertSize;
}

/** The UI posts this to insert one picked catalog component as a vector (wireframe SVG). */
interface InsertSvgMessage {
  type: "insertSvg";
  svg: string;
  name: string;
  componentId: string;
  /** Catalog theme palette; created/reused and bound to imported native properties. */
  collection?: FigmaVariableCollection;
  textStyles?: FigmaTextStyleSpec[];
  metadata?: CatalogNodeMetadata;
}

/** The UI posts this to insert one component as a native Figma component set (all variants). */
interface InsertComponentSetMessage {
  type: "insertComponentSet";
  componentId: string;
  name: string;
  /** One fetched cell per ideal render, named with its variant properties. */
  cells: InsertSetCell[];
  collection?: FigmaVariableCollection;
  textStyles?: FigmaTextStyleSpec[];
  metadata?: CatalogNodeMetadata;
}

interface CatalogNodeMetadata {
  descriptionMarkdown?: string;
  documentationUrl?: string;
  previewUrl?: string;
}

/** On startup the UI asks for the persisted catalog registry (custom + last pick). */
interface RequestRegistryMessage {
  type: "requestRegistry";
}

/** The UI persists the catalog registry (custom entries + last selection). */
interface SaveRegistryMessage {
  type: "saveRegistry";
  /** The `StoredRegistry` blob — an opaque payload the main thread just stores. */
  stored: unknown;
}

/** The UI asks the main thread to read the current selection into a frame spec. */
interface ProposeReadSelectionMessage {
  type: "proposeReadSelection";
}

/** The UI asks to refresh every live render in the current selection. */
interface RefreshMessage {
  type: "refresh";
}

/** The UI asks to re-render every selected live render at its current on-canvas size. */
interface RefreshAtSizeMessage {
  type: "refreshAtSize";
}

/** The UI posts back the freshly fetched bytes for one PNG refresh job (a fill swap). */
interface ApplyRefreshMessage {
  type: "applyRefresh";
  nodeId: string;
  bytes: Uint8Array;
}

/** The UI posts back the freshly fetched SVG text for one SVG refresh job (a re-place). */
interface ApplyRefreshSvgMessage {
  type: "applyRefreshSvg";
  nodeId: string;
  svg: string;
}

/**
 * The UI posts this to place a slotted container: its live PNG render plus the
 * parsed `/render/<id>.slots` response, so the main thread places the container and
 * materializes a frame per named slot (a structured-screen skeleton to fill).
 */
interface PlaceWithSlotsMessage {
  type: "placeWithSlots";
  source: RenderSource;
  bytes: Uint8Array;
  slots: PreviewSlots;
  name?: string;
}

/** The UI posts this to fill one slot with a child rendered to the slot's size. */
interface FillSlotMessage {
  type: "fillSlot";
  slotNodeId: string;
  source: RenderSource;
  bytes: Uint8Array;
}

type UiMessage =
  | ImportMessage
  | InsertPngMessage
  | InsertSvgMessage
  | InsertComponentSetMessage
  | RequestRegistryMessage
  | SaveRegistryMessage
  | ProposeReadSelectionMessage
  | PlaceLiveMessage
  | PlaceLiveSvgMessage
  | RefreshMessage
  | RefreshAtSizeMessage
  | ApplyRefreshMessage
  | ApplyRefreshSvgMessage
  | PlaceWithSlotsMessage
  | FillSlotMessage
  | { type: "cancel" };

// Refresh is a round-trip: the main thread plans the jobs (only it can read a
// node's provenance) and hands the URLs to the UI (the only realm that can
// `fetch`); the UI fetches and posts the bytes back per node. Hold the target
// nodes by id across that hop so an `applyRefresh` re-fills the right one.
const refreshTargets = new Map<string, FigmaNode>();

// Filling a slot is the same round-trip as refresh: the main thread materializes
// the slot frames and hands their ids to the UI (which fetches each child render),
// then the UI posts bytes back per slot id. Hold the slot frames by id across that
// hop so a `fillSlot` fills the right one.
const slotTargets = new Map<string, FigmaNode>();

/** clientStorage key the catalog registry (custom entries + last pick) persists under. */
const REGISTRY_KEY = "design-parity/catalog-registry";

/** Add the context designers expect from a library component and Dev Mode. */
async function applyCatalogMetadata(
  node: ComponentNode | ComponentSetNode,
  metadata: CatalogNodeMetadata | undefined,
): Promise<void> {
  node.setRelaunchData({ open: "Open this component in Design Parity" });
  if (!metadata) return;
  if (metadata.descriptionMarkdown) node.descriptionMarkdown = metadata.descriptionMarkdown;
  if (metadata.documentationUrl) {
    node.documentationLinks = [{ uri: metadata.documentationUrl }];
    node.setSharedPluginData(STAMP, "documentationUrl", metadata.documentationUrl);
    await node.addDevResourceAsync(metadata.documentationUrl, "Design source");
  }
  if (metadata.previewUrl) {
    node.setSharedPluginData(STAMP, "previewUrl", metadata.previewUrl);
    await node.addDevResourceAsync(metadata.previewUrl, "Open live Compose preview");
  }
}

/**
 * Read a selected node into a {@link FrameRead}: name, size, auto-layout spacing,
 * text, and the **component instances it's built from** (the building blocks,
 * carried as reference context — a frame is often composed of existing
 * components, and a screen especially so). Async because resolving an instance's
 * main component is async under `documentAccess: dynamic-page`.
 */
async function readFrame(node: SceneNode): Promise<FrameRead> {
  const read: FrameRead = {
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    texts: [],
    variables: [],
    components: [],
  };

  const layout: FrameLayout = {};
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    layout.paddingTop = node.paddingTop;
    layout.paddingRight = node.paddingRight;
    layout.paddingBottom = node.paddingBottom;
    layout.paddingLeft = node.paddingLeft;
    layout.gap = node.itemSpacing;
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    layout.cornerRadius = node.cornerRadius;
  }
  if (Object.keys(layout).length > 0) read.layout = layout;

  // Walk once, collecting text content and every component instance.
  const texts: string[] = [];
  const instances: InstanceNode[] = [];
  const walk = (n: BaseNode): void => {
    if (n.type === "TEXT" && n.characters.trim() && texts.length < 12) texts.push(n.characters);
    if (n.type === "INSTANCE") instances.push(n);
    if ("children" in n) for (const child of n.children) walk(child);
  };
  walk(node);
  read.texts = texts;

  // Resolve each instance to its component (or component-set) name — the frame's
  // building blocks. Best-effort: a failed resolve is skipped, deduped, capped.
  const components: string[] = [];
  for (const instance of instances.slice(0, 30)) {
    try {
      const main = await instance.getMainComponentAsync();
      if (!main) continue;
      const parent = main.parent;
      const name = parent && parent.type === "COMPONENT_SET" ? parent.name : main.name;
      if (name && !components.includes(name)) components.push(name);
    } catch {
      // Ignore an instance whose main component can't be resolved.
    }
  }
  read.components = components;

  return read;
}

figma.showUI(__html__, { width: 420, height: 360, themeColors: true });

figma.ui.onmessage = async (msg: UiMessage): Promise<void> => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "requestRegistry") {
    const stored = await figma.clientStorage.getAsync(REGISTRY_KEY);
    figma.ui.postMessage({ type: "registry", stored: stored ?? undefined });
    return;
  }
  if (msg.type === "saveRegistry") {
    await figma.clientStorage.setAsync(REGISTRY_KEY, msg.stored);
    return;
  }
  if (msg.type === "proposeReadSelection") {
    const node = figma.currentPage.selection[0];
    if (!node) {
      figma.ui.postMessage({ type: "selectionEmpty" });
      figma.notify("Select a frame to propose a spec from.");
      return;
    }
    try {
      const read = await readFrame(node);
      // Export the frame as a PNG so the issue can carry the visual target.
      let png: Uint8Array | undefined;
      if ("exportAsync" in node) {
        try {
          png = await (node as SceneNode & ExportMixin).exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: 2 },
          });
        } catch {
          png = undefined;
        }
      }
      figma.ui.postMessage({ type: "selectionRead", read, png });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "selectionEmpty" });
      figma.notify(`Couldn't read the selection: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "insertPng") {
    try {
      const node = placeCatalogPng(figma as unknown as FigmaApi, msg.bytes, {
        name: msg.name,
        componentId: msg.componentId,
        size: msg.size,
      });
      figma.ui.postMessage({ type: "inserted", name: node.name });
      figma.notify(`Inserted “${node.name}”.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "insertError", message });
      figma.notify(`Insert failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "insertSvg") {
    try {
      const fonts = await preflightSvgFonts(msg.svg);
      let node = placeCatalogSvg(figma as unknown as FigmaApi, msg.svg, {
        name: msg.name,
        componentId: msg.componentId,
      });
      const promoted = promoteNativeContainers(node as unknown as SceneNode);
      // A picked catalog item is reusable by intent. Preserve the imported
      // layers while giving it Figma's native main-component representation.
      if ((node as unknown as SceneNode).type !== "COMPONENT") {
        try {
          node = figma.createComponentFromNode(node as unknown as SceneNode) as unknown as FigmaNode;
          node.name = msg.name;
          node.setSharedPluginData("designParity", "role", "catalog-insert");
          node.setSharedPluginData("designParity", "componentId", msg.componentId);
        } catch {
          // Some SVG constructs cannot be componentized; the enhanced frame is
          // still a valid editable import.
        }
      }
      const bound = await bindImportedVariables(node as unknown as SceneNode, msg.svg, msg.collection);
      const styled = await bindImportedTextStyles(node as unknown as SceneNode, msg.textStyles);
      const properties = (node as unknown as SceneNode).type === "COMPONENT"
        ? exposeTextProperties(node as unknown as ComponentNode)
        : 0;
      if ((node as unknown as SceneNode).type === "COMPONENT") {
        await applyCatalogMetadata(node as unknown as ComponentNode, msg.metadata);
      }
      figma.ui.postMessage({ type: "inserted", name: node.name });
      const details = [
        promoted > 0 ? `${promoted} native container${promoted === 1 ? "" : "s"}` : "",
        bound > 0 ? `${bound} token binding${bound === 1 ? "" : "s"}` : "",
        styled > 0 ? `${styled} text style${styled === 1 ? "" : "s"}` : "",
        properties > 0 ? `${properties} text propert${properties === 1 ? "y" : "ies"}` : "",
      ].filter(Boolean).join(", ");
      const missing = fonts.missing.length > 0 ? ` Missing fonts: ${fonts.missing.join(", ")}.` : "";
      figma.notify(`Inserted “${node.name}” as an editable component${details ? ` (${details})` : ""}.${missing}`,
        fonts.missing.length > 0 ? { timeout: 5000 } : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "insertError", message });
      figma.notify(`Insert failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "insertComponentSet") {
    try {
      if (msg.cells.length === 0) throw new Error("No renders to place for this component.");
      const variants: ComponentNode[] = [];
      let editable = 0;
      let tokenBindings = 0;
      let styleBindings = 0;
      const missingFonts = new Set<string>();
      for (const cell of msg.cells) {
        let variant: ComponentNode;
        if (cell.svg) {
          const fonts = await preflightSvgFonts(cell.svg);
          for (const family of fonts.missing) missingFonts.add(family);
          let imported = placeCatalogSvg(figma as unknown as FigmaApi, cell.svg, {
            name: cell.name,
            componentId: msg.componentId,
          }) as unknown as SceneNode;
          promoteNativeContainers(imported);
          if (imported.type !== "COMPONENT") imported = figma.createComponentFromNode(imported);
          variant = imported as ComponentNode;
          tokenBindings += await bindImportedVariables(variant, cell.svg, msg.collection);
          styleBindings += await bindImportedTextStyles(variant, msg.textStyles);
          editable += 1;
        } else if (cell.bytes) {
          variant = figma.createComponent();
          variant.resize(cell.width, cell.height);
          variant.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: figma.createImage(cell.bytes).hash }];
        } else {
          throw new Error(`No SVG or PNG data for ${cell.name}.`);
        }
        variant.name = cell.name;
        variants.push(variant);
      }
      const node = figma.combineAsVariants(variants, figma.currentPage);
      node.name = msg.name;
      node.setSharedPluginData("designParity", "role", "catalog-insert");
      node.setSharedPluginData("designParity", "componentId", msg.componentId);
      const properties = exposeCommonTextProperties(node);
      await applyCatalogMetadata(node, msg.metadata);
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.ui.postMessage({ type: "inserted", name: node.name });
      const details = [
        editable > 0 ? `${editable} editable` : "",
        tokenBindings > 0 ? `${tokenBindings} token bindings` : "",
        styleBindings > 0 ? `${styleBindings} text styles` : "",
        properties > 0 ? `${properties} text properties` : "",
      ].filter(Boolean).join(", ");
      const missing = missingFonts.size ? ` Missing fonts: ${[...missingFonts].join(", ")}.` : "";
      figma.notify(`Inserted “${node.name}” set (${msg.cells.length} variants${details ? `; ${details}` : ""}).${missing}`,
        missingFonts.size ? { timeout: 5000 } : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "insertError", message });
      figma.notify(`Insert failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "placeLive") {
    try {
      const node = placeLiveRender(figma as unknown as FigmaApi, msg.source, msg.bytes, {
        name: msg.name,
      });
      figma.ui.postMessage({ type: "livePlaced", name: node.name });
      figma.notify(`Placed “${node.name}”.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
      figma.notify(`Place failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "placeLiveSvg") {
    try {
      const node = placeLiveSvg(figma as unknown as FigmaApi, msg.source, msg.svg, {
        name: msg.name,
      });
      figma.ui.postMessage({ type: "livePlaced", name: node.name });
      figma.notify(`Placed “${node.name}” (SVG).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
      figma.notify(`Place failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "refresh") {
    const selection = figma.currentPage.selection as unknown as FigmaNode[];
    const jobs = planRefresh(selection);
    refreshTargets.clear();
    for (const job of jobs) refreshTargets.set(job.node.id, job.node);
    figma.ui.postMessage({
      type: "refreshJobs",
      jobs: jobs.map((j) => ({ nodeId: j.node.id, url: j.url, format: j.format })),
    });
    if (jobs.length === 0) figma.notify("Select a live render to refresh.");
    return;
  }
  if (msg.type === "refreshAtSize") {
    // Re-stamp each selected live node with its current on-canvas size, then plan
    // the refresh as usual — planRefresh reads the now-sized provenance, so the
    // server re-renders (re-lays-out) the component for that size, and the node
    // remembers the size for later plain refreshes.
    const selection = figma.currentPage.selection;
    for (const scene of selection) {
      const node = scene as unknown as FigmaNode;
      const source = readRenderSource(node);
      if (source) stampRenderSource(node, withRenderSize(source, scene.width, scene.height));
    }
    const jobs = planRefresh(selection as unknown as FigmaNode[]);
    refreshTargets.clear();
    for (const job of jobs) refreshTargets.set(job.node.id, job.node);
    figma.ui.postMessage({
      type: "refreshJobs",
      jobs: jobs.map((j) => ({ nodeId: j.node.id, url: j.url, format: j.format })),
    });
    if (jobs.length === 0) figma.notify("Select a placed live render to re-render at its current size.");
    return;
  }
  if (msg.type === "applyRefresh") {
    const node = refreshTargets.get(msg.nodeId);
    if (!node) return;
    try {
      refreshLiveRender(figma as unknown as FigmaApi, node, msg.bytes);
      figma.ui.postMessage({ type: "refreshed", nodeId: msg.nodeId, name: node.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
    } finally {
      refreshTargets.delete(msg.nodeId);
    }
    return;
  }
  if (msg.type === "applyRefreshSvg") {
    const node = refreshTargets.get(msg.nodeId);
    if (!node) return;
    try {
      // SVG refresh replaces the node; the name is read before the old node is removed.
      const name = node.name;
      refreshLiveSvg(figma as unknown as FigmaApi, node, msg.svg);
      figma.ui.postMessage({ type: "refreshed", nodeId: msg.nodeId, name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
    } finally {
      refreshTargets.delete(msg.nodeId);
    }
    return;
  }
  if (msg.type === "placeWithSlots") {
    try {
      let container = placeLiveRender(figma as unknown as FigmaApi, msg.source, msg.bytes, {
        name: msg.name,
      });
      // Slots are an authoring contract, so make the container reusable and let
      // placeSlots use ComponentNode.createSlot() instead of generic frames.
      if (msg.slots.slots.length > 0 && (container as unknown as SceneNode).type !== "COMPONENT") {
        try {
          container = figma.createComponentFromNode(container as unknown as SceneNode) as unknown as FigmaNode;
          container.name = msg.name ?? msg.source.previewId;
        } catch {
          // Unsupported nodes keep the exact-size frame fallback.
        }
      }
      const placed = placeSlots(figma as unknown as FigmaApi, container, msg.slots);
      slotTargets.clear();
      for (const slot of placed) slotTargets.set(slot.node.id, slot.node);
      figma.ui.postMessage({
        type: "slotsPlaced",
        container: container.name,
        slots: placed.map((s) => ({ name: s.name, nodeId: s.node.id, width: s.width, height: s.height })),
      });
      figma.notify(`Placed “${container.name}” with ${placed.length} slot${placed.length === 1 ? "" : "s"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
      figma.notify(`Place failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "fillSlot") {
    const node = slotTargets.get(msg.slotNodeId);
    if (!node) return;
    try {
      fillSlot(figma as unknown as FigmaApi, node, msg.source, msg.bytes);
      figma.ui.postMessage({ type: "slotFilled", nodeId: msg.slotNodeId, name: node.name });
      figma.notify(`Filled “${node.name}”.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "liveError", message });
      figma.notify(`Fill failed: ${message}`, { error: true });
    }
    return;
  }
  if (msg.type === "import") {
    try {
      const { summary, designMap, fileKeyKnown, pendingConfirmation } = await applyImport(
        figma as unknown as FigmaApi,
        msg.plan,
        msg.images,
        { direction: msg.direction, confirmDesignLed: msg.confirm },
      );
      figma.ui.postMessage({
        type: "done",
        summary,
        designMap: JSON.stringify(designMap, null, 2),
        componentCount: designMap.components.length,
        fileKeyKnown,
        pendingConfirmation: pendingConfirmation ?? false,
      });
      figma.notify(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "error", message });
      figma.notify(`Import failed: ${message}`, { error: true });
    }
  }
};
