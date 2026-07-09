import { describe, expect, it } from "vitest";

import {
  INSERT_ROLE,
  isCatalogInsert,
  placeCatalogComponentSet,
  placeCatalogPng,
  placeCatalogSvg,
} from "../src/insert.js";
import { STAMP } from "../src/scene.js";
import { createFakeFigma, type FakeNode } from "./fakeFigma.js";

/** A fake with a current page, as the real plugin always has one. */
function paged(): ReturnType<typeof createFakeFigma> {
  const fake = createFakeFigma();
  fake.figma.currentPage = fake.figma.createPage();
  return fake;
}

describe("placeCatalogPng", () => {
  it("places a stamped frame filled with the render, sized and named", () => {
    const fake = paged();
    const node = placeCatalogPng(fake.figma, new Uint8Array([1, 2, 3]), {
      name: "Button/Filled — dark",
      componentId: "Button/Filled",
      size: { width: 200, height: 72 },
    });

    expect(node.name).toBe("Button/Filled — dark");
    expect(isCatalogInsert(node)).toBe(true);
    expect(node.getSharedPluginData(STAMP, "componentId")).toBe("Button/Filled");
    expect(node.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "img0" }]);
    expect((node as FakeNode).width).toBe(200);
    expect((node as FakeNode).height).toBe(72);

    // Appended to the current page and framed in the viewport.
    expect((fake.figma.currentPage as FakeNode).children).toContain(node);
    expect(fake.state.scrolledInto.at(-1)).toEqual([node]);
  });

  it("defaults size and name when omitted", () => {
    const fake = paged();
    const node = placeCatalogPng(fake.figma, new Uint8Array([1]));
    expect(node.name).toBe("Component");
    expect((node as FakeNode).width).toBe(320);
    expect((node as FakeNode).height).toBe(200);

    const named = placeCatalogPng(fake.figma, new Uint8Array([1]), { componentId: "Switch/On" });
    expect(named.name).toBe("Switch/On");
  });

  it("is not confused with an unstamped node", () => {
    const fake = paged();
    const plain = fake.figma.createFrame();
    expect(isCatalogInsert(plain)).toBe(false);
  });
});

describe("placeCatalogComponentSet", () => {
  const cells = [
    { name: "state=default, theme=light", bytes: new Uint8Array([1]), width: 200, height: 72 },
    { name: "state=default, theme=dark", bytes: new Uint8Array([2]), width: 200, height: 72 },
    { name: "state=pressed, theme=light", bytes: new Uint8Array([3]), width: 200, height: 72 },
  ];

  it("builds a stamped component set with one variant per cell", () => {
    const fake = paged();
    const set = placeCatalogComponentSet(fake.figma, { componentId: "Button/Filled", cells });

    expect(set.name).toBe("Button/Filled");
    expect(isCatalogInsert(set)).toBe(true);
    expect(set.getSharedPluginData(STAMP, "componentId")).toBe("Button/Filled");
    expect((set as FakeNode).kind).toBe("component-set");

    const variants = (set as FakeNode).children;
    expect(variants).toHaveLength(3);
    expect(variants.map((v) => v.name)).toEqual([
      "state=default, theme=light",
      "state=default, theme=dark",
      "state=pressed, theme=light",
    ]);
    expect(variants.every((v) => v.kind === "component")).toBe(true);
    expect(variants[0]!.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "img0" }]);
    expect((variants[0] as FakeNode).width).toBe(200);

    // Parented on the current page and framed in the viewport.
    expect((fake.figma.currentPage as FakeNode).children).toContain(set);
    expect(fake.state.scrolledInto.at(-1)).toEqual([set]);
  });

  it("names from componentId fallback and places a single-variant set", () => {
    const fake = paged();
    const set = placeCatalogComponentSet(fake.figma, {
      name: "Switch",
      cells: [cells[0]!],
    });
    expect(set.name).toBe("Switch");
    expect((set as FakeNode).children).toHaveLength(1);
  });

  it("throws when there are no cells to place", () => {
    const fake = paged();
    expect(() => placeCatalogComponentSet(fake.figma, { componentId: "X", cells: [] })).toThrow(
      /no renders/i,
    );
  });
});

describe("placeCatalogSvg", () => {
  it("parses the wireframe into a stamped vector node on the current page", () => {
    const fake = paged();
    const svg = "<svg><rect/></svg>";
    const node = placeCatalogSvg(fake.figma, svg, { name: "Button wireframe", componentId: "Button/Filled" });

    expect(node.name).toBe("Button wireframe");
    expect(isCatalogInsert(node)).toBe(true);
    expect(node.getSharedPluginData(STAMP, "role")).toBe(INSERT_ROLE);
    expect(node.getSharedPluginData(STAMP, "componentId")).toBe("Button/Filled");
    // createNodeFromSvg records the parsed SVG and self-appends to the page.
    expect((node as FakeNode).fromSvg).toBe(svg);
    expect((fake.figma.currentPage as FakeNode).children).toContain(node);
    expect(fake.state.scrolledInto.at(-1)).toEqual([node]);
  });
});
