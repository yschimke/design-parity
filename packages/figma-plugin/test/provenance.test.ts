import { describe, expect, it } from "vitest";

import { buildRenderUrl, type RenderSource } from "../src/render.js";
import {
  hasRenderSource,
  readRenderSource,
  refreshUrl,
  stampRenderSource,
} from "../src/provenance.js";
import { createFakeFigma, type FakeNode } from "./fakeFigma.js";

function node(): FakeNode {
  return createFakeFigma().figma.createFrame() as FakeNode;
}

const source: RenderSource = {
  serverBase: "http://127.0.0.1:8723",
  basePath: "compose-m3",
  token: "tok",
  previewId: "com.x.Foo#bar",
  overrides: { uiMode: "dark", fontScale: "1.5" },
  format: "png",
};

describe("render provenance stamp/read round-trip", () => {
  it("round-trips a full RenderSource through shared plugin data", () => {
    const n = node();
    stampRenderSource(n, source);
    expect(readRenderSource(n)).toEqual(source);
  });

  it("omits basePath when absent rather than storing an empty one", () => {
    const n = node();
    const { basePath: _drop, ...noBase } = source;
    stampRenderSource(n, noBase);
    const read = readRenderSource(n)!;
    expect("basePath" in read).toBe(false);
    expect(read.previewId).toBe("com.x.Foo#bar");
  });

  it("reports presence via hasRenderSource", () => {
    const n = node();
    expect(hasRenderSource(n)).toBe(false);
    stampRenderSource(n, source);
    expect(hasRenderSource(n)).toBe(true);
  });

  it("returns undefined for a node with no provenance (static import)", () => {
    expect(readRenderSource(node())).toBeUndefined();
    expect(refreshUrl(node())).toBeUndefined();
  });

  it("refreshUrl equals the render URL the source builds", () => {
    const n = node();
    stampRenderSource(n, source);
    expect(refreshUrl(n)).toBe(buildRenderUrl(source));
  });
});

describe("provenance robustness", () => {
  it("degrades malformed stored overrides to an empty map, not a throw", () => {
    const n = node();
    stampRenderSource(n, source);
    // Corrupt the overrides blob directly.
    n.setSharedPluginData("designParity", "render.overrides", "{not json");
    expect(readRenderSource(n)!.overrides).toEqual({});
  });

  it("drops non-string override values defensively", () => {
    const n = node();
    stampRenderSource(n, source);
    n.setSharedPluginData("designParity", "render.overrides", JSON.stringify({ a: "1", b: 2, c: null }));
    expect(readRenderSource(n)!.overrides).toEqual({ a: "1" });
  });

  it("falls back to png for an unrecognized stored format", () => {
    const n = node();
    stampRenderSource(n, source);
    n.setSharedPluginData("designParity", "render.format", "gif");
    expect(readRenderSource(n)!.format).toBe("png");
  });
});
