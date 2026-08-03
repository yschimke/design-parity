/** Testable Figma-runtime operation for replacing mapped legacy imports. */
import type { InsertSetCell } from "../src/insert.js";
import { STAMP } from "../src/scene.js";

export interface CatalogNodeMetadata {
  descriptionMarkdown?: string;
  documentationUrl?: string;
  previewUrl?: string;
}

export interface RuntimeUpgradeJob {
  componentId: string;
  nodeId: string;
  cells: InsertSetCell[];
  metadata?: CatalogNodeMetadata;
}

export interface BuiltUpgradeComponent {
  node: ComponentSetNode;
}

export interface MappedUpgradeResult {
  replacements: Record<string, string>;
  upgraded: string[];
  skipped: Array<{ code: string; reason: string }>;
  placed: SceneNode[];
}

export interface MappedUpgradeApi {
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
  viewport: Pick<ViewportAPI, "scrollAndZoomIntoView">;
}

export type BuildUpgradeComponent = (
  componentId: string,
  name: string,
  cells: InsertSetCell[],
  metadata: CatalogNodeMetadata | undefined,
) => Promise<BuiltUpgradeComponent>;

async function instanceCount(node: SceneNode): Promise<number> {
  if (node.type === "COMPONENT") return (await node.getInstancesAsync()).length;
  if (node.type !== "COMPONENT_SET") return node.type === "INSTANCE" ? 1 : 0;
  const counts = await Promise.all(
    node.children
      .filter((child): child is ComponentNode => child.type === "COMPONENT")
      .map((child) => child.getInstancesAsync().then((instances) => instances.length)),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * Replace only safe mapped roots with freshly built native component sets.
 *
 * The mapping is authoritative; this function never guesses from layer names.
 * A target with live instances or conflicting provenance is left untouched.
 */
export async function applyMappedUpgradeJobs(
  figma: MappedUpgradeApi,
  jobs: readonly RuntimeUpgradeJob[],
  build: BuildUpgradeComponent,
): Promise<MappedUpgradeResult> {
  const replacements: Record<string, string> = {};
  const upgraded: string[] = [];
  const skipped: Array<{ code: string; reason: string }> = [];
  const placed: SceneNode[] = [];
  for (const job of jobs) {
    let built: BuiltUpgradeComponent | undefined;
    try {
      const target = await figma.getNodeByIdAsync(job.nodeId);
      if (!target || !("x" in target) || !("remove" in target)) {
        skipped.push({ code: job.componentId, reason: "mapped node no longer exists" });
        continue;
      }
      const scene = target as SceneNode;
      if (!["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET"].includes(scene.type)) {
        skipped.push({ code: job.componentId, reason: `mapped ${scene.type.toLowerCase()} is not an upgradeable import root` });
        continue;
      }
      const stamped = scene.getSharedPluginData(STAMP, "componentId");
      if (stamped && stamped !== job.componentId) {
        skipped.push({ code: job.componentId, reason: `node belongs to ${stamped}, not this mapping` });
        continue;
      }
      if (scene.getSharedPluginData(STAMP, "nativeImportVersion") === "2") {
        skipped.push({ code: job.componentId, reason: "already uses the current native import" });
        continue;
      }
      const instances = await instanceCount(scene);
      if (instances > 0) {
        skipped.push({ code: job.componentId, reason: `${instances} live instance${instances === 1 ? "" : "s"}; skipped to preserve overrides` });
        continue;
      }
      const parent = scene.parent;
      if (!parent || !("insertChild" in parent) || !("children" in parent)) {
        skipped.push({ code: job.componentId, reason: "mapped node has no writable canvas parent" });
        continue;
      }
      const index = parent.children.indexOf(scene);
      const placement = {
        x: scene.x,
        y: scene.y,
        rotation: "rotation" in scene ? scene.rotation : 0,
        name: scene.name,
      };
      built = await build(job.componentId, placement.name, job.cells, job.metadata);
      parent.insertChild(Math.max(0, index), built.node);
      built.node.x = placement.x;
      built.node.y = placement.y;
      built.node.rotation = placement.rotation;
      scene.remove();
      replacements[job.nodeId] = built.node.id;
      upgraded.push(job.componentId);
      placed.push(built.node);
    } catch (error) {
      built?.node.remove();
      skipped.push({
        code: job.componentId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (placed.length > 0) figma.viewport.scrollAndZoomIntoView(placed);
  return { replacements, upgraded, skipped, placed };
}
