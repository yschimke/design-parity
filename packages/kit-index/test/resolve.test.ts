/**
 * Variant resolution, pinned against a real slice of the Material 3 Design Kit.
 *
 * The fixture is a genuine excerpt (six component sets and the divider folder)
 * rather than a hand-built tree, because every interesting case here is a case
 * where a *plausible* answer is the wrong one — a boolean property that would
 * happily accept the value meant for an axis, a folder sibling whose name
 * contains another's. Those only bite against vocabulary somebody really
 * authored.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { KitIndexResolver, type KitIndex } from "../src/index.js";

const kitIndex = JSON.parse(
  readFileSync(new URL("./fixtures/m3-kit-index.json", import.meta.url), "utf8"),
) as KitIndex;

const FILE = kitIndex.fileKey;
const ref = (nodeId: string): string => `figma:${FILE}/${nodeId}`;
const resolver = new KitIndexResolver(kitIndex);

describe("axis resolution", () => {
  it("resolves an exact multi-axis button cell", () => {
    expect(
      resolver.resolveVariant(ref("57994:2324"), [
        { key: "size", raw: "l" },
        { key: "shape", raw: "square" },
      ]),
    ).toEqual({
      nodeId: "57994:2310",
      name: "Type=Square, Size=Large, State=Enabled",
    });
  });

  it("accepts an explicit default size inside a multi-axis matrix cell", () => {
    expect(
      resolver.resolveVariant(ref("57994:10132"), [
        { key: "size", raw: "s" },
        { key: "width", raw: "narrow" },
        { key: "shape", raw: "square" },
      ]),
    ).toEqual({
      nodeId: "57994:10104",
      name: "Type=Square, Size=Small, Width=Narrow, State=Enabled",
    });
  });

  it("does not duplicate a base reference for a redundant single-axis seed", () => {
    // The seed names the size the base already is. One axis, no movement — the
    // honest answer is that there is no second node to compare against.
    expect(
      resolver.resolveVariant(ref("57998:43398"), { key: "size", raw: "small" }),
    ).toBeUndefined();
  });

  it("does not map two different content configurations to label and icon", () => {
    expect(
      resolver.resolveVariant(ref("54563:40116"), { key: "content", raw: "icon" }),
    ).toEqual({
      nodeId: "54563:40070",
      name: "Configuration=Fixed, Style=Primary, Layout=Icon only",
    });
    // The secondary-style sibling publishes no icon-only layout. Reporting the
    // primary one would be a confident reference to a different component.
    expect(
      resolver.resolveVariant(ref("54563:40047"), { key: "content", raw: "icon" }),
    ).toBeUndefined();
  });

  it("prefers a real variant axis over a similarly named component property", () => {
    // The toggle-button set declares BOTH a `Selected` axis and an
    // `Icon (selected)` property. Projecting the seed onto the property first
    // would resolve to a node that never changed its selected state.
    expect(
      resolver.resolveVariant(ref("57994:2485"), { key: "selected", raw: "true" }),
    ).toEqual({
      nodeId: "57994:2475",
      name: "Type=Round, Size=Small, State=Enabled, Selected=True",
    });
  });
});

describe("hidden sets and their render aliases", () => {
  it("uses visible examples for hidden component-set definitions", () => {
    expect(resolver.renderableRef(ref("53977:33611"))).toBe(ref("53977:34289"));
  });

  it("resolves through the alias rather than to the unrenderable definition", () => {
    expect(
      resolver.resolveVariant(ref("53977:33611"), {
        key: "configuration",
        raw: "text+action",
      }),
    ).toEqual({
      nodeId: "53977:34287",
      name: "Configuration=Text & action, # of lines=One line, Show close affordance=False",
    });
  });

  it("leaves a reference with no alias untouched", () => {
    expect(resolver.renderableRef(ref("57994:2324"))).toBe(ref("57994:2324"));
  });
});

describe("standalone folder siblings", () => {
  it("resolves a divider to its folder sibling", () => {
    expect(
      resolver.resolveVariant(ref("51816:5860"), { key: "inset", raw: "inset" }),
    ).toEqual({ nodeId: "51816:5868", name: "Horizontal/Inset" });
  });

  it("does not compose mutually exclusive standalone siblings", () => {
    // Folder siblings are complete configurations, not composable axes. Walking
    // from one to another and calling the last their combination would invent a
    // component the kit does not publish.
    expect(
      resolver.resolveVariant(ref("51816:5860"), [
        { key: "subhead", raw: "true" },
        { key: "inset", raw: "16" },
      ]),
    ).toBeUndefined();
  });
});

describe("file scoping", () => {
  it("refuses a ref addressed to a different file", () => {
    // Node ids are unique per file only. Answering about a same-numbered node
    // in another document is the one wrong answer that looks entirely right.
    expect(
      resolver.resolveVariant(`figma:someOtherFile/57994:2324`, [
        { key: "size", raw: "l" },
        { key: "shape", raw: "square" },
      ]),
    ).toBeUndefined();
  });

  it("accepts a bare node id, since the index already names its file", () => {
    expect(
      resolver.resolveVariant("57994:2324", [
        { key: "size", raw: "l" },
        { key: "shape", raw: "square" },
      ])?.nodeId,
    ).toBe("57994:2310");
  });

  it("resolves nothing for an unknown node", () => {
    expect(
      resolver.resolveVariant(ref("0:0"), { key: "size", raw: "l" }),
    ).toBeUndefined();
  });

  it("resolves nothing when given no seeds", () => {
    expect(resolver.resolveVariant(ref("57994:2324"), [])).toBeUndefined();
  });
});

describe("reporting what a reference silently depicts", () => {
  it("names the boolean content a set switches on by default", () => {
    const defaulted = resolver.defaultedContent(ref("57994:2324"));
    expect(defaulted.map((d) => d.name)).toContain("Show icon");
    expect(defaulted.every((d) => d.setName === "Button")).toBe(true);
  });

  it("reports a knob the kit models as a property rather than an axis", () => {
    const property = resolver.propertyForSeed(ref("57994:2324"), {
      key: "icon",
      raw: "true",
    });
    expect(property?.setName).toBe("Button");
    // The Button set declares BOTH `Icon` (which icon) and `Show icon`
    // (whether to draw one). An exact name match outranks a match on one word
    // of a longer name, so the knob names `Icon` — and because that is an
    // instance swap rather than a switch, the seed has no lossless property
    // value and the variant stays unpaired rather than being approximated.
    expect(property?.properties.map((p) => p.name)).toEqual(["Icon"]);
    expect(property?.properties.map((p) => p.type)).toEqual(["INSTANCE_SWAP"]);
    expect(property?.coversVariant).toBe(false);
  });

  it("marks a boolean property whose default already covers the seed", () => {
    // `Show focus indicator` is reachable without collision, and defaults to
    // false — so `focus=false` describes what the reference already draws, and
    // it is the base pair beside it that would depict something else.
    const property = resolver.propertyForSeed(ref("57994:2324"), {
      key: "focus",
      raw: "false",
    });
    expect(property?.properties.map((p) => p.name)).toEqual([
      "Show focus indicator",
    ]);
    expect(property?.coversVariant).toBe(true);
  });

  it("returns nothing for a reference that is not a set variant", () => {
    expect(resolver.propertyForSeed(ref("51816:5860"), { key: "icon", raw: "true" }))
      .toBeUndefined();
    expect(resolver.defaultedContent(ref("51816:5860"))).toEqual([]);
  });
});
