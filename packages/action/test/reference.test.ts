import { describe, it, expect } from "vitest";

import type {
  AdapterContext,
  Correspondence,
  DesignReference,
  Image,
  ReferenceAdapter,
} from "@design-parity/core";

import { resolveReference } from "../src/reference.js";

const ctx: AdapterContext = { repoRoot: "/repo", env: {} };

/** An adapter that returns a canned reference per ref handle. */
function fakeAdapter(byRef: Record<string, DesignReference>): ReferenceAdapter {
  return {
    source: "figma",
    resolve: async (_code, ref) => {
      const reference = byRef[ref];
      if (!reference) throw new Error(`unexpected ref ${ref}`);
      return reference;
    },
  };
}

function ref(uri: string, tokens?: DesignReference["tokens"]): DesignReference {
  const image: Image = { state: "node", uri, width: 1, height: 1 };
  const r: DesignReference = {
    componentId: "ui/Device.kt#DeviceScreen",
    source: "figma",
    linkMethod: "manifest",
    ref: uri,
    referenceImages: [image],
  };
  if (tokens) r.tokens = tokens;
  return r;
}

describe("resolveReference", () => {
  it("passes a single-ref correspondence straight through", async () => {
    const reference = ref("only.png");
    const adapter = fakeAdapter({ only: reference });
    const corr: Correspondence = {
      code: "ui/Device.kt#DeviceScreen",
      source: "figma",
      ref: "only",
      linkMethod: "manifest",
      confidence: "high",
    };
    expect(await resolveReference(adapter, corr, ctx)).toBe(reference);
  });

  it("merges multi-node refs, re-tagging each image with its variant slot", async () => {
    const adapter = fakeAdapter({
      r1: ref("r1.png", { colors: { onSurface: "#111111" } }),
      r2: ref("r2.png", { colors: { onSurface: "#222222" } }),
      r3: ref("r3.png"),
    });
    const corr: Correspondence = {
      code: "ui/Device.kt#DeviceScreen",
      source: "figma",
      ref: "r1",
      refs: [
        { ref: "r1", state: "default" },
        { ref: "r2", state: "error" },
        { ref: "r3", theme: "dark" }, // no state override → keeps the node's state
      ],
      linkMethod: "manifest",
      confidence: "high",
    };

    const merged = await resolveReference(adapter, corr, ctx);

    expect(merged.referenceImages).toEqual([
      { state: "default", uri: "r1.png", width: 1, height: 1 },
      { state: "error", uri: "r2.png", width: 1, height: 1 },
      { state: "node", theme: "dark", uri: "r3.png", width: 1, height: 1 },
    ]);
    // Structure + tokens come from the primary (first) node.
    expect(merged.tokens).toEqual({ colors: { onSurface: "#111111" } });
    expect(merged.ref).toBe("r1.png");
    expect(merged.componentId).toBe("ui/Device.kt#DeviceScreen");
  });
});

describe("a multi-ref merge keeps the primary's structure", () => {
  // This merge lists the fields it carries one by one, which is what made the
  // loss silent: `layout` and `themeTokens` were simply never named, so every
  // multi-ref entry resolved to a reference with no captured geometry and no
  // system table — 45 of wear-m3-catalog's 49 components, including the
  // `SwipeToRevealCard` of #371. Nothing downstream errors on that; it all just
  // turns itself off.
  const withStructure = (uri: string): DesignReference => ({
    ...ref(uri),
    layout: {
      boundsDensity: 3,
      root: {
        bounds: { x: 0, y: 0, width: 576, height: 312 },
        children: [{ label: "Section", bounds: { x: 36, y: 36, width: 504, height: 54 } }],
      },
    },
    themeTokens: { colors: { primary: "#645AFF" } },
  });

  it("carries the captured layout and the design-system table", async () => {
    const adapter = fakeAdapter({
      "figma:K/1:1": withStructure("figma:K/1:1"),
      "figma:K/1:2": withStructure("figma:K/1:2"),
    });
    const corr: Correspondence = {
      code: "ui/Device.kt#DeviceScreen",
      source: "figma",
      ref: "figma:K/1:1",
      refs: [{ ref: "figma:K/1:1", theme: "light" }, { ref: "figma:K/1:2", theme: "dark" }],
      linkMethod: "manifest",
      confidence: "high",
    };

    const merged = await resolveReference(adapter, corr, ctx);

    // Guard the guard: this only tests the merge while the fixture really is
    // multi-ref and really did merge both nodes' images.
    expect(corr.refs).toHaveLength(2);
    expect(merged.referenceImages).toHaveLength(2);

    expect(merged.layout?.root.children).toHaveLength(1);
    // The density stamp has to survive too, or a scaled board's boxes are read
    // as dp downstream and the corroboration silently stops matching.
    expect(merged.layout?.boundsDensity).toBe(3);
    expect(merged.themeTokens?.colors).toMatchObject({ primary: "#645AFF" });
  });

  it("stays absent when the primary captured neither", async () => {
    const adapter = fakeAdapter({ "figma:K/1:1": ref("figma:K/1:1") });
    const corr: Correspondence = {
      code: "ui/Device.kt#DeviceScreen",
      source: "figma",
      ref: "figma:K/1:1",
      refs: [{ ref: "figma:K/1:1" }],
      linkMethod: "manifest",
      confidence: "high",
    };
    const merged = await resolveReference(adapter, corr, ctx);
    expect("layout" in merged).toBe(false);
    expect("themeTokens" in merged).toBe(false);
  });
});
