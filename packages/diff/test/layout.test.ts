import { describe, it, expect } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import { defaultDiffConfig } from "../src/config.js";
import { diffLayout } from "../src/layout.js";

/** Build a flat tree of labelled boxes `[label, x, y, w, h]`. */
function tree(...nodes: [string, number, number, number, number][]): SemanticTree {
  return {
    root: {
      children: nodes.map(([label, x, y, width, height]) => ({ label, bounds: { x, y, width, height } })),
    },
  };
}

describe("diffLayout", () => {
  const cand = tree(["Title", 16, 16, 100, 24], ["Send", 360, 850, 24, 24]);

  it("is empty when the reference matches the candidate", () => {
    expect(diffLayout(cand, cand, defaultDiffConfig)).toEqual([]);
  });

  it("is a no-op when the reference has no captured bounds", () => {
    const noBounds: SemanticTree = { root: { children: [{ label: "Title" }] } };
    expect(diffLayout(noBounds, cand, defaultDiffConfig)).toEqual([]);
  });

  it("flags a shifted element with its delta", () => {
    const ref = tree(["Title", 16, 8, 100, 24], ["Send", 360, 850, 24, 24]); // Title 8dp higher
    const f = diffLayout(ref, cand, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: "layout",
      severity: "warn",
      detail: { label: "Title", dx: 0, dy: -8, dw: 0, dh: 0 },
    });
  });

  it("flags a size delta (e.g. an input 8dp shorter)", () => {
    const ref = tree(["Title", 16, 16, 100, 24], ["Send", 360, 850, 24, 24], ["Message", 8, 850, 338, 48]);
    const withInput = tree(...[
      ["Title", 16, 16, 100, 24],
      ["Send", 360, 850, 24, 24],
      ["Message", 8, 850, 338, 56],
    ] as [string, number, number, number, number][]);
    const f = diffLayout(ref, withInput, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ detail: { label: "Message", dh: -8 } });
  });

  it("absorbs sub-tolerance drift (density rounding)", () => {
    const ref = tree(["Title", 17, 18, 102, 24], ["Send", 360, 850, 24, 24]); // ≤ 4dp off
    expect(diffLayout(ref, cand, defaultDiffConfig)).toEqual([]);
  });

  it("pairs repeated labels to the nearest counterpart", () => {
    const c = tree(["Joined", 300, 100, 60, 24], ["Joined", 300, 240, 60, 24]);
    // second 'Joined' shifted 10dp down; first matches
    const r = tree(["Joined", 300, 100, 60, 24], ["Joined", 300, 250, 60, 24]);
    const f = diffLayout(r, c, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatchObject({ label: "Joined", dy: 10 });
  });

  it("ignores a reference element with no candidate counterpart", () => {
    const r = tree(["Title", 16, 16, 100, 24], ["Ghost", 0, 500, 40, 40]);
    expect(diffLayout(r, cand, defaultDiffConfig)).toEqual([]);
  });
});
