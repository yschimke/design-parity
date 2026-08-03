import { describe, expect, it, vi } from "vitest";

import {
  applyMappedUpgradeJobs,
  type MappedUpgradeApi,
  type RuntimeUpgradeJob,
} from "../figma/mappedUpgrade.js";

interface UpgradeNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  children: UpgradeNode[];
  parent: UpgradeNode | null;
  removed: boolean;
  pluginData: Record<string, Record<string, string>>;
  insertChild(index: number, child: UpgradeNode): void;
  remove(): void;
  getSharedPluginData(namespace: string, key: string): string;
  getInstancesAsync(): Promise<UpgradeNode[]>;
}

let nextId = 0;

function upgradeNode(type: string, values: Partial<UpgradeNode> = {}): UpgradeNode {
  const result: UpgradeNode = {
    id: `${nextId++}:0`,
    type,
    name: type,
    x: 0,
    y: 0,
    rotation: 0,
    children: [],
    parent: null,
    removed: false,
    pluginData: {},
    insertChild(index: number, child: UpgradeNode): void {
      if (child.parent) child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
      child.parent = result;
      result.children.splice(index, 0, child);
    },
    remove(): void {
      if (result.parent) result.parent.children = result.parent.children.filter((candidate) => candidate !== result);
      result.parent = null;
      result.removed = true;
    },
    getSharedPluginData(namespace: string, key: string): string {
      return result.pluginData[namespace]?.[key] ?? "";
    },
    async getInstancesAsync(): Promise<UpgradeNode[]> { return []; },
    ...values,
  };
  return result;
}

function append(parent: UpgradeNode, ...children: UpgradeNode[]): void {
  children.forEach((child) => parent.insertChild(parent.children.length, child));
}

function job(componentId: string, nodeId: string): RuntimeUpgradeJob {
  return {
    componentId,
    nodeId,
    cells: [{
      name: "state=default",
      width: 120,
      height: 48,
      bytes: new Uint8Array([1, 2, 3]),
    }],
    metadata: { documentationUrl: "https://example.test/source" },
  };
}

function api(nodes: UpgradeNode[], scroll = vi.fn()): MappedUpgradeApi {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    getNodeByIdAsync: async (id: string) => (byId.get(id) ?? null) as unknown as BaseNode | null,
    viewport: { scrollAndZoomIntoView: scroll },
  };
}

describe("applyMappedUpgradeJobs", () => {
  it("replaces a mapped legacy root in place and reports its new correspondence", async () => {
    nextId = 0;
    const parent = upgradeNode("PAGE");
    const before = upgradeNode("FRAME", { name: "Before" });
    const legacy = upgradeNode("FRAME", { name: "Primary button", x: 240, y: 96, rotation: 7 });
    const after = upgradeNode("FRAME", { name: "After" });
    append(parent, before, legacy, after);
    const replacement = upgradeNode("COMPONENT_SET", { name: "new" });
    const scroll = vi.fn();
    const build = vi.fn(async () => ({ node: replacement as unknown as ComponentSetNode }));

    const result = await applyMappedUpgradeJobs(
      api([legacy], scroll),
      [job("Button/Filled", legacy.id)],
      build,
    );

    expect(build).toHaveBeenCalledWith(
      "Button/Filled",
      "Primary button",
      expect.arrayContaining([expect.objectContaining({ name: "state=default" })]),
      { documentationUrl: "https://example.test/source" },
    );
    expect(parent.children).toEqual([before, replacement, after]);
    expect(replacement).toMatchObject({ name: "new", x: 240, y: 96, rotation: 7 });
    expect(legacy.removed).toBe(true);
    expect(result).toMatchObject({
      replacements: { [legacy.id]: replacement.id },
      upgraded: ["Button/Filled"],
      skipped: [],
      placed: [replacement],
    });
    expect(scroll).toHaveBeenCalledWith([replacement]);
  });

  it("skips missing, unsafe, already-native, conflicting, and live-instance roots", async () => {
    nextId = 0;
    const text = upgradeNode("TEXT");
    const conflicting = upgradeNode("FRAME", {
      pluginData: { designParity: { componentId: "Card/Filled" } },
    });
    const current = upgradeNode("FRAME", {
      pluginData: { designParity: { nativeImportVersion: "2" } },
    });
    const live = upgradeNode("COMPONENT", {
      getInstancesAsync: async () => [upgradeNode("INSTANCE")],
    });
    const orphan = upgradeNode("FRAME");
    const parent = upgradeNode("PAGE");
    append(parent, text, conflicting, current, live);
    const build = vi.fn();
    const scroll = vi.fn();

    const result = await applyMappedUpgradeJobs(
      api([text, conflicting, current, live, orphan], scroll),
      [
        job("Missing", "999:0"),
        job("Text", text.id),
        job("Button/Filled", conflicting.id),
        job("Button/Filled", current.id),
        job("Button/Filled", live.id),
        job("Button/Filled", orphan.id),
      ],
      build,
    );

    expect(build).not.toHaveBeenCalled();
    expect(result.upgraded).toEqual([]);
    expect(result.replacements).toEqual({});
    expect(result.skipped.map((item) => item.reason)).toEqual([
      "mapped node no longer exists",
      "mapped text is not an upgradeable import root",
      "node belongs to Card/Filled, not this mapping",
      "already uses the current native import",
      "1 live instance; skipped to preserve overrides",
      "mapped node has no writable canvas parent",
    ]);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("removes a partially built replacement when insertion fails", async () => {
    nextId = 0;
    const parent = upgradeNode("PAGE", {
      insertChild(): void { throw new Error("document became read-only"); },
    });
    const legacy = upgradeNode("FRAME", { parent });
    parent.children = [legacy];
    const replacement = upgradeNode("COMPONENT_SET");

    const result = await applyMappedUpgradeJobs(
      api([legacy]),
      [job("Button/Filled", legacy.id)],
      async () => ({ node: replacement as unknown as ComponentSetNode }),
    );

    expect(replacement.removed).toBe(true);
    expect(legacy.removed).toBe(false);
    expect(result.upgraded).toEqual([]);
    expect(result.skipped).toEqual([{ code: "Button/Filled", reason: "document became read-only" }]);
  });
});
