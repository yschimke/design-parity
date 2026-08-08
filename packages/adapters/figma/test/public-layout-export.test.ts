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

  it("names the type after the published style the node actually wears", () => {
    // A published style IS the file saying what it calls that type — reporting it
    // is not the same as inventing `labelLarge` for a node that wears nothing.
    const styled = {
      ...node,
      children: [{ ...node.children[0], styles: { text: "S:abc" } }],
    };
    const text = layoutFromNode(styled as never, {
      styles: { "S:abc": { key: "abc", name: "Body/Large", styleType: "TEXT" } },
    })?.root.children?.[0].tokens?.typography;
    expect(Object.keys(text ?? {})).toEqual(["body/large"]);
  });

  it("falls back to `text` when the style id resolves to nothing", () => {
    const styled = {
      ...node,
      children: [{ ...node.children[0], styles: { text: "S:missing" } }],
    };
    const text = layoutFromNode(styled as never, { styles: {} })?.root.children?.[0].tokens
      ?.typography;
    expect(Object.keys(text ?? {})).toEqual(["text"]);
  });

  it("marks declared spacing as declared", () => {
    expect(layoutFromNode(node as never)?.root.spacingSource).toBe("declared");
  });

  it("carries a stated density so a consumer can quote the board in dp", () => {
    expect(layoutFromNode(node as never, { density: 3 })?.density).toBe(3);
    expect(layoutFromNode(node as never)?.density).toBeUndefined();
    // A nonsense factor is worse than none: it would silently divide every spec.
    expect(layoutFromNode(node as never, { density: 0 })?.density).toBeUndefined();
  });
});

/**
 * Most annotated design frames are hand-placed, not auto-layout, so they declare
 * no `padding*` / `itemSpacing` at all and the redline walk drops every one of
 * them — the reference column of a compare page ends up with a type layer and no
 * layout layer, which is the more common design-review question missing.
 *
 * Measuring the same vocabulary off child geometry fills it, at the cost of the
 * numbers being observations rather than specs — so every one is flagged.
 */
describe("spacing derived from child geometry", () => {
  const frame = (children: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "1:2",
    name: "Card",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children,
    ...extra,
  });
  const kid = (id: string, x: number, y: number, width: number, height: number) => ({
    id,
    name: `Kid ${id}`,
    type: "RECTANGLE",
    absoluteBoundingBox: { x, y, width, height },
  });

  it("measures the inset from the parent box to the content box", () => {
    const tree = layoutFromNode(frame([kid("1:3", 10, 20, 70, 60)]) as never);
    expect(tree?.root.tokens?.spacing).toEqual({
      paddingStart: 10,
      paddingTop: 20,
      paddingEnd: 20,
      paddingBottom: 20,
    });
    expect(tree?.root.spacingSource).toBe("derived");
  });

  it("measures an evenly spaced run as a gap", () => {
    const tree = layoutFromNode(
      frame([kid("1:3", 10, 10, 80, 20), kid("1:4", 10, 42, 80, 20)]) as never,
    );
    expect(tree?.root.tokens?.spacing?.gap).toBe(12);
  });

  it("reports no gap when the run is uneven — a mean would state a rhythm that isn't there", () => {
    const tree = layoutFromNode(
      frame([
        kid("1:3", 10, 10, 80, 10),
        kid("1:4", 10, 28, 80, 10),
        kid("1:5", 10, 70, 80, 10),
      ]) as never,
    );
    expect(tree?.root.tokens?.spacing?.gap).toBeUndefined();
  });

  it("reports no gap for children that overlap on both axes", () => {
    const tree = layoutFromNode(
      frame([kid("1:3", 10, 10, 40, 40), kid("1:4", 20, 20, 40, 40)]) as never,
    );
    expect(tree?.root.tokens?.spacing?.gap).toBeUndefined();
  });

  it("reports no gap for a grid — there is no single stacking axis", () => {
    const tree = layoutFromNode(
      frame([kid("1:3", 10, 10, 30, 30), kid("1:4", 50, 50, 30, 30)]) as never,
    );
    expect(tree?.root.tokens?.spacing?.gap).toBeUndefined();
  });

  it("omits an all-zero inset — a child filling its parent is not a spec", () => {
    const tree = layoutFromNode(frame([kid("1:3", 0, 0, 100, 100)]) as never);
    expect(tree?.root.tokens).toBeUndefined();
    expect(tree?.root.spacingSource).toBeUndefined();
  });

  it("drops only the edge a child overflows, not the whole inset", () => {
    const tree = layoutFromNode(frame([kid("1:3", 10, 10, 120, 60)]) as never);
    expect(tree?.root.tokens?.spacing).toEqual({
      paddingStart: 10,
      paddingTop: 10,
      paddingBottom: 30,
    });
  });

  it("leaves a declared frame alone — a partial auto-layout spec is still the designer's", () => {
    const tree = layoutFromNode(
      frame([kid("1:3", 10, 20, 70, 60)], { paddingTop: 4 }) as never,
    );
    expect(tree?.root.tokens?.spacing).toEqual({ paddingTop: 4 });
    expect(tree?.root.spacingSource).toBe("declared");
  });

  it("derives nothing for a leaf", () => {
    const tree = layoutFromNode(frame([kid("1:3", 10, 10, 80, 80)]) as never);
    expect(tree?.root.children?.[0].tokens).toBeUndefined();
  });
});
