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

  it("normalises a denser candidate into the reference's dp space via frame width", () => {
    // Reference captured at 411dp; candidate rendered at 2× density (822px wide).
    // Scaling the candidate back by 411/822 = 0.5 makes the geometry line up, so
    // an exact-but-denser render produces no findings.
    const ref: SemanticTree = {
      root: { bounds: { x: 0, y: 0, width: 411, height: 200 }, children: [{ label: "Go", bounds: { x: 20, y: 30, width: 100, height: 40 } }] },
    };
    const denser: SemanticTree = {
      root: { bounds: { x: 0, y: 0, width: 822, height: 400 }, children: [{ label: "Go", bounds: { x: 40, y: 60, width: 200, height: 80 } }] },
    };
    expect(diffLayout(ref, denser, defaultDiffConfig)).toEqual([]);
  });

  it("flags drift that survives the density normalisation", () => {
    const ref: SemanticTree = {
      root: { bounds: { x: 0, y: 0, width: 411, height: 200 }, children: [{ label: "Go", bounds: { x: 20, y: 30, width: 100, height: 40 } }] },
    };
    // Same 2× frame, but the element sits 40px (=20dp) lower than it should.
    const drifted: SemanticTree = {
      root: { bounds: { x: 0, y: 0, width: 822, height: 400 }, children: [{ label: "Go", bounds: { x: 40, y: 100, width: 200, height: 80 } }] },
    };
    const f = diffLayout(ref, drifted, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatchObject({ label: "Go", dy: -20 });
  });

  it("ignores a text node's content-driven width delta (glyph box vs fill-width row)", () => {
    // A section header at the same place, but the candidate reports the full-width
    // row while the reference measured the tight text — a huge Δwidth, no shift.
    const ref = tree(["Channels (1)", 0, 100, 80, 24]);
    const filled = tree(["Channels (1)", 0, 100, 360, 24]); // Δwidth -280, same y/height
    expect(diffLayout(ref, filled, defaultDiffConfig)).toEqual([]);
  });

  it("still flags a text node's real vertical drift, width aside", () => {
    const ref = tree(["Channels (1)", 0, 100, 80, 24]);
    const drifted = tree(["Channels (1)", 0, 112, 360, 24]); // 12dp lower + wider
    const f = diffLayout(ref, drifted, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatchObject({ label: "Channels (1)", dy: -12, dw: -280 });
  });

  it("still flags a role-bearing object's width/size delta", () => {
    // An icon button (carries a role) is real geometry — its box is gated in full.
    const ref: SemanticTree = {
      root: { children: [{ label: "Menu", role: "button", bounds: { x: 0, y: 100, width: 48, height: 48 } }] },
    };
    const smaller: SemanticTree = {
      root: { children: [{ label: "Menu", role: "button", bounds: { x: 0, y: 100, width: 32, height: 48 } }] },
    };
    const f = diffLayout(ref, smaller, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatchObject({ label: "Menu", dw: 16 });
  });

  it("does not scale when a frame is absent on either side", () => {
    // No root bounds ⇒ assume a shared space; a uniformly 2× candidate is NOT
    // normalised away, so its drift is reported (we only de-densify with frames).
    const ref = tree(["A", 0, 0, 100, 20]);
    const big = tree(["A", 0, 0, 200, 40]);
    const f = diffLayout(ref, big, defaultDiffConfig);
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatchObject({ label: "A", dw: -100, dh: -20 });
  });
});
