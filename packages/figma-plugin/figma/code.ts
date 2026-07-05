/**
 * Main-thread plugin entry — the only realm with the `figma` scene API.
 *
 * Thin bootstrap: wire the UI, and on an import message hand the real `figma`
 * plus the plan + fetched bytes to {@link applyImport}, which owns the scene
 * logic and is tested headlessly against a fake API (`src/scene.ts`,
 * `test/fakeFigma.ts`). The one `as unknown as FigmaApi` cast bridges Figma's
 * exhaustive `PluginAPI` to the structural subset the builder needs.
 */
import { applyImport, type FetchedImage, type FigmaApi } from "../src/scene.js";
import type { ParityDirection } from "../src/direction.js";
import type { ImportPlan } from "../src/plan.js";

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

type UiMessage = ImportMessage | { type: "cancel" };

figma.showUI(__html__, { width: 420, height: 360, themeColors: true });

figma.ui.onmessage = async (msg: UiMessage): Promise<void> => {
  if (msg.type === "cancel") {
    figma.closePlugin();
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
