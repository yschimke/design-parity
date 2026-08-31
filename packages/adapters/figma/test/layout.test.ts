import { describe, it, expect } from "vitest";

import type { FigmaNodeDoc } from "../src/figma-api.js";
import { layoutFromNode } from "../src/layout.js";

/**
 * A screen frame parked away from the canvas origin — the realistic case, and
 * the one that makes root-relative bounds load-bearing.
 */
const screen: FigmaNodeDoc = {
  id: "1:1",
  name: "DeviceScreen",
  type: "FRAME",
  absoluteBoundingBox: { x: 12040, y: -320, width: 412, height: 892 },
  children: [
    {
      id: "1:2",
      name: "header",
      type: "FRAME",
      absoluteBoundingBox: { x: 12040, y: -320, width: 412, height: 64 },
      children: [
        {
          id: "1:3",
          name: "Title text layer",
          type: "TEXT",
          characters: "  Device  ",
          absoluteBoundingBox: { x: 12056, y: -304, width: 90, height: 28 },
        },
      ],
    },
    {
      id: "1:4",
      name: "Toggle",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 12380, y: -300, width: 52, height: 32 },
    },
  ],
};

describe("layoutFromNode", () => {
  it("stamps the node's own box as the root frame", () => {
    expect(layoutFromNode(screen)!.root.bounds).toEqual({
      x: 0,
      y: 0,
      width: 412,
      height: 892,
    });
  });

  it("makes child bounds root-relative", () => {
    const byLabel = new Map(
      layoutFromNode(screen)!.root.children!.map((c) => [c.label, c.bounds]),
    );
    // 12056 - 12040 = 16;  -304 - -320 = 16
    expect(byLabel.get("Device")).toEqual({ x: 16, y: 16, width: 90, height: 28 });
    expect(byLabel.get("Toggle")).toEqual({ x: 340, y: 20, width: 52, height: 32 });
  });

  it("flattens nested nodes and excludes the root itself", () => {
    const labels = layoutFromNode(screen)!.root.children!.map((c) => c.label);
    expect(labels).toEqual(["header", "Device", "Toggle"]);
    expect(labels).not.toContain("DeviceScreen");
  });

  it("labels text nodes by visible string, trimmed — not by layer name", () => {
    const text = layoutFromNode(screen)!.root.children!.find((c) => c.label === "Device");
    expect(text).toBeDefined();
    expect(text!.label).toBe("Device");
  });

  it("leaves text nodes role-less so the diff's text gating applies", () => {
    const children = layoutFromNode(screen)!.root.children!;
    expect(children.find((c) => c.label === "Device")!.role).toBeUndefined();
    // Non-text keeps a role, so its full box (width included) is compared.
    expect(children.find((c) => c.label === "Toggle")!.role).toBe("instance");
    expect(children.find((c) => c.label === "header")!.role).toBe("frame");
  });

  it("preserves a text fill and its nearest visible container fill for reference contrast", () => {
    const tree = layoutFromNode({
      id: "1",
      name: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [
        {
          id: "2",
          name: "swatch",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
          fills: [{ type: "SOLID", color: { r: 0.47, g: 0.45, b: 0.49, a: 1 } }],
          children: [
            {
              id: "3",
              name: "label",
              type: "TEXT",
              characters: "Outline",
              absoluteBoundingBox: { x: 8, y: 8, width: 40, height: 16 },
              fills: [{ type: "SOLID", color: { r: 1, g: 0.97, b: 1, a: 1 } }],
              style: { fontSize: 11, fontWeight: 500 },
            },
          ],
        },
      ],
    });

    expect(tree!.root.children!.find((c) => c.label === "Outline")!.tokens).toMatchObject({
      colors: { label: "#FFF7FF", container: "#78737D" },
      typography: { text: { fontSize: 11, fontWeight: 500 } },
    });
  });

  it("returns undefined when the node carries no bounding box", () => {
    expect(layoutFromNode({ id: "1", name: "n", type: "FRAME" })).toBeUndefined();
  });

  it("returns undefined when nothing inside is matchable", () => {
    expect(
      layoutFromNode({
        id: "1",
        name: "empty",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toBeUndefined();
  });

  it("skips children with no box or no label, keeping the rest", () => {
    const tree = layoutFromNode({
      id: "1",
      name: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        { id: "2", name: "unbounded", type: "FRAME" },
        { id: "3", name: "   ", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 } },
        { id: "4", name: "kept", type: "RECTANGLE", absoluteBoundingBox: { x: 1, y: 2, width: 3, height: 4 } },
      ],
    });
    expect(tree!.root.children!.map((c) => c.label)).toEqual(["kept"]);
  });

  it("falls back to the layer name for a text node with no characters", () => {
    const tree = layoutFromNode({
      id: "1",
      name: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        { id: "2", name: "Fallback", type: "TEXT", absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 8 } },
      ],
    });
    expect(tree!.root.children![0]!.label).toBe("Fallback");
  });

  it("rounds fractional geometry to whole dp", () => {
    const tree = layoutFromNode({
      id: "1",
      name: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0.4, y: 0.4, width: 99.6, height: 50.5 },
      children: [
        {
          id: "2",
          name: "child",
          type: "RECTANGLE",
          absoluteBoundingBox: { x: 8.9, y: 4.2, width: 12.5, height: 3.4 },
        },
      ],
    });
    expect(tree!.root.bounds).toEqual({ x: 0, y: 0, width: 100, height: 51 });
    expect(tree!.root.children![0]!.bounds).toEqual({ x: 9, y: 4, width: 13, height: 3 });
  });
});
