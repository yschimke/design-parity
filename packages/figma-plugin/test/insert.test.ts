import { describe, expect, it } from "vitest";

import { INSERT_ROLE, isCatalogInsert, placeCatalogPng, placeCatalogSvg } from "../src/insert.js";
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
