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
