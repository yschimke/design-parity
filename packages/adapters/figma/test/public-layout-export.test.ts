import { describe, expect, it } from "vitest";

import { layoutFromNode } from "../src/index.js";

/**
 * `layoutFromNode` is part of the package's public surface, not an internal
 * helper: a publisher that already fetched Figma node JSON uses it to build the
 * same tree the adapter builds, so reference-side annotations are measured by the
 * same code as the adapter's own diff. Importing it from the package entry point
 * is the contract this pins — a refactor that drops it from `index.ts` breaks a
 * downstream consumer that the adapter's own tests would otherwise never exercise.
 */
describe("public layout capture", () => {
  it("is reachable from the package entry point", () => {
    expect(typeof layoutFromNode).toBe("function");
  });

  it("builds a root-relative tree from a bounded node", () => {
    const tree = layoutFromNode({
      id: "1:2",
      name: "Button",
      type: "FRAME",
      absoluteBoundingBox: { x: 12040, y: 900, width: 200, height: 48 },
      children: [
        {
          id: "1:3",
          name: "Label",
          type: "TEXT",
          absoluteBoundingBox: { x: 12086, y: 926, width: 108, height: 20 },
        },
      ],
    } as never);

    // Canvas-space coordinates must not leak through — a frame at x=12040 would
    // make every delta meaningless.
    expect(tree?.root.bounds).toEqual({ x: 0, y: 0, width: 200, height: 48 });
    expect(tree?.root.children?.[0].bounds).toEqual({ x: 46, y: 26, width: 108, height: 20 });
  });

  it("returns undefined for a node with no box, rather than inventing one", () => {
    expect(layoutFromNode({ id: "1:2", name: "x", type: "FRAME" } as never)).toBeUndefined();
  });
});
