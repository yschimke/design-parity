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

describe("axes that fold two knobs into one value", () => {
  // The Checkboxes set files error states as `Type=Error selected`, not as a
  // `State` beside `Selected` — one published value carrying what a catalog
  // spells as two knobs. Without fusing, the second seed finds no axis left
  // that accepts it and variants the catalog already renders resolve to
  // nothing. `51859:5665` is `Type=Unselected, State=Enabled`.
  const unselected = ref("51859:5665");

  it("reaches a fused value from two seeds", () => {
    expect(
      resolver.resolveVariant(unselected, [
        { key: "status", raw: "error" },
        { key: "state", raw: "unchecked" },
      ]),
    ).toEqual({
      nodeId: "51859:5668",
      name: "Type=Error unselected, State=Enabled",
    });
  });

  it("fuses across a value the base does not already carry", () => {
    expect(
      resolver.resolveVariant(unselected, [
        { key: "state", raw: "checked" },
        { key: "status", raw: "error" },
      ]),
    ).toEqual({
      nodeId: "51859:5633",
      name: "Type=Error selected, State=Enabled",
    });
  });

  it("is sensitive to seed order when the first seed is a no-op", () => {
    // `state=unchecked` against an already-Unselected base is a no-op, and a
    // one-axis no-op is skipped before it can claim the axis the fusion would
    // need. Pinned rather than smoothed over: this matches the upstream
    // implementation exactly, and the catalog's annotation order is what feeds
    // it. Flipping the two seeds resolves, as the case above shows.
    expect(
      resolver.resolveVariant(unselected, [
        { key: "state", raw: "unchecked" },
        { key: "status", raw: "error" },
      ]),
    ).toBeUndefined();
  });

  it("does not fuse a single seed into a two-word value", () => {
    // Set EQUALITY, not containment — otherwise `unchecked` alone would claim
    // `Error unselected` and silently add an error state nobody asked for.
    expect(
      resolver.resolveVariant(unselected, { key: "state", raw: "unchecked" }),
    ).toBeUndefined();
  });
});

describe("interaction states", () => {
  const unselected = ref("51859:5665");

  it("resolves the hovered, focused and pressed states the kit draws", () => {
    expect(resolver.resolveVariant(unselected, { key: "state", raw: "hovered" })?.name)
      .toBe("Type=Unselected, State=Hovered");
    expect(resolver.resolveVariant(unselected, { key: "state", raw: "focused" })?.name)
      .toBe("Type=Unselected, State=Focused");
    expect(resolver.resolveVariant(unselected, { key: "state", raw: "pressed" })?.name)
      .toBe("Type=Unselected, State=Pressed");
  });

  it("reaches a disabled state through the status knob", () => {
    expect(resolver.resolveVariant(unselected, { key: "status", raw: "disabled" })?.name)
      .toBe("Type=Unselected, State=Disabled");
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

describe("slugged values the kit spells with its own spacing", () => {
  it("reaches a multi-word published value from a hyphenated knob", () => {
    // `center-aligned-hero` is the kit's `Center-aligned hero` — a hyphen in one
    // place and a space in the other, which no amount of swapping one for the
    // other reaches. Normalising both sides to letters and digits does, and it
    // can only ever return a value the axis actually publishes.
    expect(
      resolver.resolveVariant(ref("53912:27481"), {
        key: "layout",
        raw: "center-aligned-hero",
      }),
    ).toEqual({
      nodeId: "54577:25914",
      name: "Context=Tablet, Layout=Center-aligned hero",
    });
  });

  it("still refuses a spelling the kit does not publish", () => {
    expect(
      resolver.resolveVariant(ref("53912:27481"), {
        key: "layout",
        raw: "left-aligned-hero",
      }),
    ).toBeUndefined();
  });

  it("does not normalise a bare number, which would reach the wrong value", () => {
    // `progress=1.0` normalises to `10`, a real value of a `Progress` axis and
    // the wrong one; the candidate list already turns 1.0 into `100`. A hyphen
    // or a space is what says "this is a phrase the kit spells its own way".
    expect(
      resolver.resolveVariant(ref("53912:27481"), { key: "layout", raw: "1.0" }),
    ).toBeUndefined();
  });

  it("reads a second axis the same knob names on another component", () => {
    // `layout` is a code word for both a card's `Layout` and a picker's
    // `Orientation`; the value decides which answers.
    expect(
      resolver.resolveVariant(ref("52949:28014"), { key: "layout", raw: "vertical" }),
    ).toEqual({ nodeId: "52949:27946", name: "Format=24 hour, Orientation=Vertical" });
  });
});

describe("saying why a vector resolved to nothing", () => {
  // "No counterpart in the kit" is true of every miss and useful about almost
  // none of them. These three are what a reader actually has to tell apart, and
  // the first two are not gaps at all — reading them as gaps sends someone
  // looking through a design file for a node that was never missing.

  it("recognises a reference that already draws the variant", () => {
    // The base IS `Size=XLarge`, so `size=xl` duplicates it. Reported as a gap,
    // this reads as a missing XLarge button in a kit that plainly has one.
    const reason = resolver.explainUnresolved(ref("57994:2308"), [
      { key: "size", raw: "xl" },
    ]);
    expect(reason).toEqual({ kind: "base", variant: "Type=Square, Size=XLarge, State=Enabled" });
  });

  it("separates a hole in the matrix from a hole in the vocabulary", () => {
    // Both values are real and the kit draws each of them from this base — a
    // `Text & longer action` snackbar and a one-line one — but it draws no
    // one-line `Text & longer action`. Nothing is missing from the vocabulary
    // here, so pointing a reader at the seeds would waste their time; the kit's
    // own matrix simply skips that cell.
    const reason = resolver.explainUnresolved(ref("53977:33595"), [
      { key: "labels", raw: "text-longer-action" },
      { key: "lines", raw: "one" },
    ]);
    expect(reason).toEqual({
      kind: "combination",
      seeds: ["labels=text-longer-action", "lines=one"],
    });
  });

  it("names only the seeds that are actually missing", () => {
    // The failure that motivated this: a two-seed render where one seed is
    // perfectly well known. Quoting the whole vector sends the reader after
    // both, and `state=unselected` is not the problem.
    const reason = resolver.explainUnresolved(ref("51859:5629"), [
      { key: "state", raw: "unchecked" },
      { key: "elevation", raw: "3" },
    ]);
    expect(reason.kind).toBe("seeds");
    expect(reason).toMatchObject({ missing: ["elevation=3"] });
  });
});

describe("a declared kit axis or value", () => {
  // The escape hatch for what the alias tables cannot reach. Before it, a
  // catalog whose kit spells a value `Type=Full-screen (range)` had to seed
  // that string in Kotlin source — a kit spelling made load-bearing in code,
  // which rots the moment the kit renames a variant value.

  const snackbar = ref("53977:33595"); // Text only, Two lines, close=True

  it("reaches a value no alias table spells", () => {
    const seed = { key: "action", raw: "longer" };
    // On its own the knob says nothing the kit recognises: `longer` is not a
    // published value of any axis, so this is the silent drop the declaration
    // exists to remove.
    expect(resolver.resolveVariant(snackbar, seed)).toBeUndefined();
    expect(
      resolver.resolveVariant(snackbar, {
        ...seed,
        kitAxis: "Configuration",
        kitValue: "Text & longer action",
      }),
    ).toEqual({
      nodeId: "53977:33576",
      name: "Configuration=Text & longer action, # of lines=Two lines, Show close affordance=True",
    });
  });

  it("reaches an axis the vocabulary never proposes for the knob", () => {
    const seed = { key: "dismiss", raw: "false" };
    expect(resolver.resolveVariant(snackbar, seed)).toBeUndefined();
    expect(
      resolver.resolveVariant(snackbar, {
        ...seed,
        kitAxis: "Show close affordance",
      }),
    ).toEqual({
      nodeId: "53977:34285",
      name: "Configuration=Text only, # of lines=Two lines, Show close affordance=False",
    });
  });

  it("matches the kit's spelling without demanding its punctuation", () => {
    // `# of lines` is the kit's own axis name. Declaring it should not turn
    // into a typing exercise, so the match normalises both sides — and can
    // still only ever land on an axis the set really publishes.
    expect(
      resolver.resolveVariant(snackbar, {
        key: "rows",
        raw: "1",
        kitAxis: "of lines",
        kitValue: "One line",
      }),
    ).toEqual({
      nodeId: "53977:34288",
      name: "Configuration=Text only, # of lines=One line, Show close affordance=True",
    });
  });

  it("is authoritative, not a hint: a wrong axis resolves to nothing", () => {
    // The seed resolves perfectly well on its own. Falling back to that when
    // the declaration misses would make a typo indistinguishable from a
    // correct declaration — and quietly answer a question nobody asked.
    const button = ref("57994:2324");
    expect(resolver.resolveVariant(button, { key: "size", raw: "l" })).toEqual({
      nodeId: "57994:2320",
      name: "Type=Round, Size=Large, State=Enabled",
    });
    expect(
      resolver.resolveVariant(button, { key: "size", raw: "l", kitAxis: "Sise" }),
    ).toBeUndefined();
    expect(
      resolver.resolveVariant(button, {
        key: "size",
        raw: "l",
        kitAxis: "Size",
        kitValue: "Enormous",
      }),
    ).toBeUndefined();
  });

  it("names a declaration the set cannot honour", () => {
    const button = ref("57994:2324");
    expect(
      resolver.explainUnresolved(button, [
        { key: "size", raw: "l", kitAxis: "Sise" },
      ]),
    ).toEqual({
      kind: "declared",
      missing: [
        {
          seed: "size=l",
          declares: "axis",
          named: "Sise",
          published: ["Type", "Size", "State"],
        },
      ],
    });

    const reason = resolver.explainUnresolved(button, [
      { key: "size", raw: "l", kitAxis: "Size", kitValue: "Enormous" },
    ]);
    expect(reason.kind).toBe("declared");
    expect(reason).toMatchObject({
      missing: [{ seed: "size=l", declares: "value", named: "Enormous" }],
    });
    // The values the axis does publish are the whole point: the reason is a
    // correction, not another "resolved to nothing".
    expect(
      (reason as { missing: { published: string[] }[] }).missing[0]?.published,
    ).toContain("Large");
  });

  it("reaches a knob the kit models as a property rather than an axis", () => {
    // Which of the two a kit uses is the kit's business. A declaration names
    // the kit's word; the property path honours it the same way the axis
    // search does.
    expect(
      resolver.propertyForSeed(ref("57994:2324"), {
        key: "art",
        raw: "false",
        kitAxis: "Show icon",
      }),
    ).toMatchObject({
      setName: "Button",
      properties: [{ name: "Show icon", type: "BOOLEAN" }],
    });
  });
});

describe("a declaration cannot buy what the kit does not draw", () => {
  // Every case here is one where taking the declaration on trust would produce
  // a confident reference to the wrong node — the failure the whole package is
  // built to avoid, and one an authoritative declaration could reintroduce.

  it("checks a declared fusion against the value the earlier seed chose", () => {
    // The base is `Type=Selected`; the second seed declares the kit's
    // `Error unselected`. Letting the declaration overwrite the axis outright
    // would resolve to the UNSELECTED node and diff selected code against it.
    const checkbox = ref("51859:5629");
    expect(
      resolver.resolveVariant(checkbox, [
        { key: "state", raw: "selected" },
        { key: "status", raw: "error", kitValue: "Error unselected" },
      ]),
    ).toBeUndefined();
    // The fusion the kit really publishes for those two still resolves.
    expect(
      resolver.resolveVariant(checkbox, [
        { key: "state", raw: "unchecked" },
        { key: "status", raw: "error", kitValue: "Error unselected" },
      ])?.name,
    ).toBe("Type=Error unselected, State=Enabled");
  });

  it("matches a declared property name exactly, not by word", () => {
    // `matchProperty` accepts `focus` for `Show focus indicator`, which is the
    // right latitude for a knob key and the wrong latitude for a declaration:
    // the author is asserting the kit's own name.
    const button = ref("57994:2324");
    expect(
      resolver.propertyForSeed(button, { key: "focus", raw: "true" }),
    ).toMatchObject({ properties: [{ name: "Show focus indicator" }] });
    expect(
      resolver.propertyForSeed(button, { key: "x", raw: "true", kitAxis: "focus" }),
    ).toBeUndefined();
  });

  it("names the sibling outright for a folder-modelled family", () => {
    // `inset` reaches `Inset` by the near-miss search; a declaration is how a
    // catalog says it meant the OTHER one, and it is matched exactly.
    const divider = ref("51816:5868"); // Horizontal/Inset
    expect(
      resolver.resolveVariant(divider, {
        key: "inset",
        raw: "inset",
        kitValue: "Middle-inset",
      }),
    ).toEqual({ nodeId: "51816:5870", name: "Horizontal/Middle-inset" });
    // A folder has no axes, so an axis declaration names nothing that could be
    // honoured — refused rather than quietly ignored.
    expect(
      resolver.resolveVariant(divider, {
        key: "inset",
        raw: "subhead",
        kitAxis: "Configuration",
      }),
    ).toBeUndefined();
    expect(
      resolver.explainUnresolved(divider, [
        { key: "inset", raw: "subhead", kitAxis: "Configuration" },
      ]),
    ).toMatchObject({
      kind: "declared",
      missing: [{ declares: "axis", named: "Configuration", published: [] }],
    });
  });

  it("does not let a non-Latin axis name match whatever was indexed first", () => {
    // The ASCII normalisation used for slugs erases `サイズ` and `状態` alike, so
    // an equality test on it would match the first axis in the set and cite the
    // wrong node with complete confidence.
    const localised = new KitIndexResolver({
      fileKey: "LocalKit",
      generatedBy: "test",
      sets: {
        "1:1": {
          name: "ボタン",
          variants: [
            { id: "1:2", name: "サイズ=小, 状態=通常" },
            { id: "1:3", name: "サイズ=大, 状態=通常" },
            { id: "1:4", name: "サイズ=小, 状態=無効" },
          ],
        },
      },
      standalone: {},
      specimens: {},
    });
    expect(
      localised.resolveVariant("figma:LocalKit/1:2", {
        key: "state",
        raw: "disabled",
        kitAxis: "状態",
        kitValue: "無効",
      }),
    ).toEqual({ nodeId: "1:4", name: "サイズ=小, 状態=無効" });
    expect(
      localised.resolveVariant("figma:LocalKit/1:2", {
        key: "size",
        raw: "l",
        kitAxis: "状態",
        kitValue: "大",
      }),
    ).toBeUndefined();
  });
});

describe("what a declaration's reason has to get right", () => {
  it("reads a declared value naming the reference itself as the base case", () => {
    // `#componentSiblings` excludes the node being walked from, so validating
    // against the siblings alone would tell an author to fix a declaration that
    // names the reference exactly — the standalone form of "already drawn".
    const divider = ref("51816:5868"); // Horizontal/Inset
    expect(
      resolver.explainUnresolved(divider, [
        { key: "inset", raw: "inset", kitValue: "Inset" },
      ]),
    ).toEqual({ kind: "base", variant: "Horizontal/Inset" });
    // …and a sibling the folder really lacks still reports what it does have.
    expect(
      resolver.explainUnresolved(divider, [
        { key: "inset", raw: "inset", kitValue: "Outset" },
      ]),
    ).toMatchObject({
      kind: "declared",
      missing: [{ declares: "value", named: "Outset" }],
    });
  });

  it("does not call two non-Latin values the same value", () => {
    // Both erase to nothing under the slug normalisation, so a `base` verdict
    // would report a missing node as one the reference already draws.
    const localised = new KitIndexResolver({
      fileKey: "LocalKit",
      generatedBy: "test",
      sets: {
        "1:1": {
          name: "ボタン",
          variants: [
            { id: "1:2", name: "サイズ=小, 状態=通常" },
            { id: "1:3", name: "サイズ=大, 状態=無効" },
          ],
        },
      },
      standalone: {},
      specimens: {},
    });
    const seeds = [{ key: "state", raw: "disabled", kitAxis: "状態", kitValue: "無効" }];
    expect(localised.resolveVariant("figma:LocalKit/1:2", seeds)).toBeUndefined();
    expect(localised.explainUnresolved("figma:LocalKit/1:2", seeds).kind).not.toBe(
      "base",
    );
  });
});

describe("a standalone render with more than one declaration", () => {
  it("finishes validating before calling the reference already-drawn", () => {
    // The first seed names the reference itself; the second is misspelt. Returning `base` on the
    // first hides the only thing there is to fix — and every multi-seed standalone vector
    // resolves to nothing anyway, so "already drawn" would be the wrong answer twice over.
    expect(
      resolver.explainUnresolved(ref("51816:5868"), [
        { key: "inset", raw: "inset", kitValue: "Inset" },
        { key: "subhead", raw: "true", kitAxis: "Configuration" },
      ]),
    ).toMatchObject({
      kind: "declared",
      missing: [{ declares: "axis", named: "Configuration" }],
    });
  });
});

describe("a declaration that lands on a component property", () => {
  const button = ref("57994:2324");

  it("still has its value checked against what the property can take", () => {
    // The NAME being real is not the whole check. Without this the typo hides
    // behind the property-shaped classification — the one verdict that means
    // "nothing to fix here".
    expect(
      resolver.explainUnresolved(button, [
        { key: "art", raw: "off", kitAxis: "Show icon", kitValue: "Flase" },
      ]),
    ).toEqual({
      kind: "declared",
      missing: [
        {
          seed: "art=off",
          declares: "value",
          named: "Flase",
          published: ["True", "False"],
        },
      ],
    });
  });

  it("leaves a well-formed property declaration to the property report", () => {
    expect(
      resolver.explainUnresolved(button, [
        { key: "art", raw: "off", kitAxis: "Show icon", kitValue: "False" },
      ]).kind,
    ).not.toBe("declared");
  });

  it("accepts a declared no-op in a compound vector whatever the knob is called", () => {
    // The base IS `Size=Small`, and this cell spells that explicitly beside the
    // state it really moves. The exception used to key on the code word `size`,
    // which is the one thing a declaration exists to stop mattering.
    expect(
      resolver.resolveVariant(button, [
        { key: "density", raw: "compact", kitAxis: "Size", kitValue: "Small" },
        { key: "state", raw: "disabled" },
      ]),
    ).toEqual({
      nodeId: "58651:12649",
      name: "Type=Round, Size=Small, State=Disabled",
    });
  });
});

describe("a value-only declaration on a property-shaped knob", () => {
  const button = ref("57994:2324");

  it("is judged by the property, not by a variant axis that does not exist", () => {
    // `focus` names no axis of the Button set, so validating against axes alone
    // called a perfectly good declaration a miss — and, since that reason
    // outranks the property one, took the property report down with it.
    expect(
      resolver.explainUnresolved(button, [
        { key: "focus", raw: "on", kitValue: "True" },
      ]).kind,
    ).not.toBe("declared");
    // A value the property genuinely cannot take is still reported.
    expect(
      resolver.explainUnresolved(button, [
        { key: "focus", raw: "on", kitValue: "Ture" },
      ]),
    ).toMatchObject({
      kind: "declared",
      missing: [{ declares: "value", named: "Ture" }],
    });
  });
});

describe("what a declared name may not quietly match", () => {
  it("keeps a decimal apart from the whole number it would flatten to", () => {
    // Dropping separators turns `1.0` into `10` — a real value of the Carousel
    // fixture's neighbours and, on a `Progress` axis, exactly the confident
    // wrong node the slug matcher is already careful to avoid.
    const numeric = new KitIndexResolver({
      fileKey: "NumKit",
      generatedBy: "test",
      sets: {
        "1:1": {
          name: "Progress indicator",
          variants: [
            { id: "1:2", name: "Progress=0" },
            { id: "1:3", name: "Progress=10" },
            { id: "1:4", name: "Progress=100" },
          ],
        },
      },
      standalone: {},
      specimens: {},
    });
    expect(
      numeric.resolveVariant("figma:NumKit/1:2", {
        key: "progress",
        raw: "1.0",
        kitAxis: "Progress",
        kitValue: "1.0",
      }),
    ).toBeUndefined();
    expect(
      numeric.resolveVariant("figma:NumKit/1:2", {
        key: "progress",
        raw: "1.0",
        kitAxis: "Progress",
        kitValue: "100",
      })?.name,
    ).toBe("Progress=100");
  });

  it("refuses a declaration two published names both answer to", () => {
    // `Full screen` and `Full-screen` differ only by what the comparison drops,
    // so the declaration does not say which was meant. Picking either is the
    // wrong reference half the time; nothing is the honest answer.
    const twins = new KitIndexResolver({
      fileKey: "TwinKit",
      generatedBy: "test",
      sets: {
        "1:1": {
          name: "Date picker",
          variants: [
            { id: "1:2", name: "Type=Docked" },
            { id: "1:3", name: "Type=Full screen" },
            { id: "1:4", name: "Type=Full-screen" },
          ],
        },
      },
      standalone: {},
      specimens: {},
    });
    expect(
      twins.resolveVariant("figma:TwinKit/1:2", {
        key: "type",
        raw: "full",
        kitAxis: "Type",
        kitValue: "Fullscreen",
      }),
    ).toBeUndefined();
  });
});
