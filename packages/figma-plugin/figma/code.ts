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
import { placeLiveRender, placeLiveSvg, planRefresh, refreshLiveRender } from "../src/live.js";
import type { ImportPlan } from "../src/plan.js";
import type { RenderSource } from "../src/render.js";

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

/** The UI posts back the freshly fetched bytes for one refresh job. */
interface ApplyRefreshMessage {
  type: "applyRefresh";
  nodeId: string;
  bytes: Uint8Array;
}

type UiMessage =
  | ImportMessage
  | PlaceLiveMessage
  | PlaceLiveSvgMessage
  | RefreshMessage
  | ApplyRefreshMessage
  | { type: "cancel" };

// Refresh is a round-trip: the main thread plans the jobs (only it can read a
// node's provenance) and hands the URLs to the UI (the only realm that can
// `fetch`); the UI fetches and posts the bytes back per node. Hold the target
// nodes by id across that hop so an `applyRefresh` re-fills the right one.
const refreshTargets = new Map<string, FigmaNode>();

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
      jobs: jobs.map((j) => ({ nodeId: j.node.id, url: j.url })),
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
