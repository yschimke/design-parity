import { describe, expect, it } from "vitest";

import {
  isLiveRender,
  placeLiveRender,
  placeLiveSvg,
  planRefresh,
  refreshLiveRender,
  LIVE_ROLE,
} from "../src/live.js";
import { readRenderSource, refreshUrl } from "../src/provenance.js";
import { buildRenderUrl, type RenderSource } from "../src/render.js";
import { createFakeFigma, type FakeNode } from "./fakeFigma.js";

const source: RenderSource = {
  serverBase: "http://127.0.0.1:8723",
  basePath: "compose-m3",
  token: "tok",
  previewId: "Button/Filled",
  overrides: { "knob.label": "string:Save", uiMode: "dark" },
  format: "png",
};

const svgSource: RenderSource = { ...source, format: "svg" };

/** A fake with a current page, as the real plugin always has one. */
function paged(): ReturnType<typeof createFakeFigma> {
  const fake = createFakeFigma();
  fake.figma.currentPage = fake.figma.createPage();
  return fake;
}

describe("placeLiveRender", () => {
  it("places a stamped, provenance-carrying frame filled with the render", () => {
    const fake = paged();
    const node = placeLiveRender(fake.figma, source, new Uint8Array([1, 2, 3]));

    expect(node.name).toBe("Button/Filled");
    expect(isLiveRender(node)).toBe(true);
    expect(node.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "img0" }]);
    // The stamped provenance round-trips, so a later Refresh rebuilds the exact URL.
    expect(readRenderSource(node)).toEqual(source);
    expect(refreshUrl(node)).toBe(buildRenderUrl(source));
    // Appended to the current page and framed in the viewport.
    expect((fake.figma.currentPage as FakeNode).children).toContain(node);
    expect(fake.state.scrolledInto.at(-1)).toEqual([node]);
  });

  it("defaults the node size and honours an explicit size + name", () => {
    const fake = paged();
    const dflt = placeLiveRender(fake.figma, source, new Uint8Array([1]));
    expect((dflt as FakeNode).width).toBe(320);
    expect((dflt as FakeNode).height).toBe(200);

    const sized = placeLiveRender(fake.figma, source, new Uint8Array([1]), {
      size: { width: 100, height: 60 },
      name: "Custom",
    });
    expect(sized.name).toBe("Custom");
    expect((sized as FakeNode).width).toBe(100);
    expect((sized as FakeNode).height).toBe(60);
  });
});

describe("placeLiveSvg", () => {
  it("parses the SVG into a stamped node carrying its svg-format provenance", () => {
    const fake = paged();
    const node = placeLiveSvg(fake.figma, svgSource, "<svg><rect/></svg>", { name: "Filled" });

    expect(node.name).toBe("Filled");
    expect(isLiveRender(node)).toBe(true);
    // The vector was parsed (not set as an image fill), and the page carries it.
    expect((node as FakeNode).fromSvg).toBe("<svg><rect/></svg>");
    expect(node.fills).toBeUndefined();
    expect((fake.figma.currentPage as FakeNode).children).toContain(node);
    // Provenance round-trips with format svg, so a later re-place rebuilds the .svg URL.
    expect(readRenderSource(node)).toEqual(svgSource);
    expect(refreshUrl(node)).toBe(buildRenderUrl(svgSource));
    expect(fake.state.scrolledInto.at(-1)).toEqual([node]);
  });
});

describe("refreshLiveRender", () => {
  it("swaps the fill for new bytes and returns the node's source", () => {
    const fake = paged();
    const node = placeLiveRender(fake.figma, source, new Uint8Array([1]));

    const refreshed = refreshLiveRender(fake.figma, node, new Uint8Array([9]));
    expect(refreshed).toEqual(source);
    // A new image hash — the fill was replaced, identity + provenance untouched.
    expect(node.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "img1" }]);
    expect(readRenderSource(node)).toEqual(source);
  });

  it("no-ops (undefined) on a node with no render provenance", () => {
    const fake = paged();
    const plain = fake.figma.createFrame();
    expect(isLiveRender(plain)).toBe(false);
    expect(refreshLiveRender(fake.figma, plain, new Uint8Array([1]))).toBeUndefined();
  });

  it("no-ops on an SVG node — it refreshes by re-placement, not a fill swap", () => {
    const fake = paged();
    const node = placeLiveSvg(fake.figma, svgSource, "<svg/>");
    expect(refreshLiveRender(fake.figma, node, new Uint8Array([1]))).toBeUndefined();
    expect(node.fills).toBeUndefined(); // untouched — no bogus image fill on a vector node
  });
});

describe("planRefresh", () => {
  it("yields a re-fetch job only for nodes carrying render provenance", () => {
    const fake = paged();
    const live = placeLiveRender(fake.figma, source, new Uint8Array([1]));
    const plain = fake.figma.createFrame(); // a designer's own node — no provenance

    const jobs = planRefresh([live, plain]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.node).toBe(live);
    // The job URL is exactly what the node's stamp rebuilds.
    expect(jobs[0]!.url).toBe(buildRenderUrl(source));
  });

  it("is empty for a selection with no live renders", () => {
    const fake = paged();
    expect(planRefresh([fake.figma.createFrame()])).toEqual([]);
  });

  it("skips SVG live nodes (they refresh by re-placement, not an in-place re-fetch)", () => {
    const fake = paged();
    const png = placeLiveRender(fake.figma, source, new Uint8Array([1]));
    const svg = placeLiveSvg(fake.figma, svgSource, "<svg/>");

    const jobs = planRefresh([png, svg]);
    expect(jobs.map((j) => j.node)).toEqual([png]);
  });
});

describe("LIVE_ROLE", () => {
  it("is the stamped role a Refresh command scans selection for", () => {
    expect(LIVE_ROLE).toBe("live-render");
  });
});
