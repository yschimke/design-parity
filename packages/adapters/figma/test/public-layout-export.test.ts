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

/**
 * Geometry alone says where an element is; these tokens say what it is *specified*
 * as. Without them the redline walk finds a box with no spacing spec and drops it,
 * so a reference column renders no annotations at all — which is exactly what
 * happened before this capture existed.
 */
describe("captured spec tokens", () => {
  const node = {
    id: "1:2",
    name: "Button",
    type: "FRAME",
    absoluteBoundingBox: { x: 12040, y: 900, width: 200, height: 48 },
    itemSpacing: 8,
    cornerRadius: 20,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12,
    children: [
      {
        id: "1:3",
        name: "Label",
        type: "TEXT",
        absoluteBoundingBox: { x: 12086, y: 926, width: 108, height: 20 },
        style: { fontFamily: "Roboto", fontSize: 14, lineHeightPx: 20, fontWeight: 500 },
      },
    ],
  };

  it("keys spacing the way the redline walk reads it", () => {
    // These names are a contract with catalog-export's nodeRedline; renaming either
    // side silently drops every layout annotation.
    expect(layoutFromNode(node as never)?.root.tokens?.spacing).toEqual({
      paddingTop: 12,
      paddingBottom: 12,
      paddingStart: 16,
      paddingEnd: 16,
      gap: 8,
    });
  });

  it("maps Figma's physical left/right onto start/end", () => {
    const tokens = layoutFromNode({ ...node, paddingLeft: 4, paddingRight: 24 } as never)?.root
      .tokens?.spacing;
    expect(tokens?.paddingStart).toBe(4);
    expect(tokens?.paddingEnd).toBe(24);
  });

  it("keys the corner radius as `corner`", () => {
    expect(layoutFromNode(node as never)?.root.tokens?.radius).toEqual({ corner: 20 });
  });

  it("captures a text style without inventing a design-token name", () => {
    // The node cannot say whether it is `labelLarge`; claiming one would read as a
    // spec the file never made.
    const text = layoutFromNode(node as never)?.root.children?.[0].tokens?.typography;
    expect(Object.keys(text ?? {})).toEqual(["text"]);
    expect(text?.text).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: 500 });
  });

  it("omits tokens entirely for a node that specifies nothing", () => {
    const bare = {
      id: "1:2",
      name: "Plain",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      children: [
        { id: "1:3", name: "Kid", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 4, height: 4 } },
      ],
    };
    const tree = layoutFromNode(bare as never);
    expect(tree?.root.tokens).toBeUndefined();
    expect(tree?.root.children?.[0].tokens).toBeUndefined();
  });
});
