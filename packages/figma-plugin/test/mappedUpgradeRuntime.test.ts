import { describe, expect, it, vi } from "vitest";

import {
  applyMappedUpgradeJobs,
  type MappedUpgradeApi,
  type RuntimeUpgradeJob,
} from "../figma/mappedUpgrade.js";
import {
  appendRuntimeNodes as append,
  resetRuntimeIds,
  type RuntimeNode,
  runtimeNode as upgradeNode,
  sceneContract,
} from "./figmaRuntimeHarness.js";

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

function api(nodes: RuntimeNode[], scroll = vi.fn()): MappedUpgradeApi {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    getNodeByIdAsync: async (id: string) => (byId.get(id) ?? null) as unknown as BaseNode | null,
    viewport: { scrollAndZoomIntoView: scroll },
  };
}

describe("applyMappedUpgradeJobs", () => {
  it("replaces a mapped legacy root in place and reports its new correspondence", async () => {
    resetRuntimeIds();
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
    expect(sceneContract(parent)).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "children": [],
            "name": "Before",
            "position": {
              "x": 0,
              "y": 0,
            },
            "size": {
              "height": 0,
              "width": 0,
            },
            "type": "FRAME",
          },
          {
            "children": [],
            "name": "new",
            "position": {
              "x": 240,
              "y": 96,
            },
            "rotation": 7,
            "size": {
              "height": 0,
              "width": 0,
            },
            "type": "COMPONENT_SET",
          },
          {
            "children": [],
            "name": "After",
            "position": {
              "x": 0,
              "y": 0,
            },
            "size": {
              "height": 0,
              "width": 0,
            },
            "type": "FRAME",
          },
        ],
        "name": "PAGE",
        "position": {
          "x": 0,
          "y": 0,
        },
        "size": {
          "height": 0,
          "width": 0,
        },
        "type": "PAGE",
      }
    `);
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
    resetRuntimeIds();
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
    resetRuntimeIds();
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
