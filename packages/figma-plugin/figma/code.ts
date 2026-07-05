/**
 * Main-thread plugin entry — the only realm with the `figma` scene API.
 *
 * Thin bootstrap: wire the UI, and on an import message hand the real `figma`
 * plus the plan + fetched bytes to {@link applyImport}, which owns the scene
 * logic and is tested headlessly against a fake API (`src/scene.ts`,
 * `test/fakeFigma.ts`). The one `as unknown as FigmaApi` cast bridges Figma's
 * exhaustive `PluginAPI` to the structural subset the builder needs.
 */
import { applyImport, type FetchedImage, type FigmaApi, type FigmaNode } from "../src/scene.js";
import type { ParityDirection } from "../src/direction.js";
import {
  placeLiveRender,
  placeLiveSvg,
  planRefresh,
  refreshLiveRender,
  refreshLiveSvg,
} from "../src/live.js";
import type { ImportPlan } from "../src/plan.js";
import type { RenderSource } from "../src/render.js";
import type { PreviewSlots } from "../src/slots.js";
import { fillSlot, placeSlots } from "../src/structure.js";

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

/** The UI asks to refresh every live render in the current selection. */
interface RefreshMessage {
  type: "refresh";
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
  | PlaceLiveMessage
  | PlaceLiveSvgMessage
  | RefreshMessage
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

figma.showUI(__html__, { width: 420, height: 360, themeColors: true });

figma.ui.onmessage = async (msg: UiMessage): Promise<void> => {
  if (msg.type === "cancel") {
    figma.closePlugin();
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
      const container = placeLiveRender(figma as unknown as FigmaApi, msg.source, msg.bytes, {
        name: msg.name,
      });
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
