/**
 * Folding declared variant renders into a design map.
 *
 * Runs against the committed slice of the real Material 3 kit, because the
 * whole point of this step is that the answers come from vocabulary somebody
 * actually authored — a synthetic index would prove only that the plumbing
 * runs. The enriched map is checked against `@design-parity/core`'s own schema
 * rather than a shape asserted here, so a drift in what the map is allowed to
 * look like fails this suite instead of the consumer's.
 */
import { readFileSync } from "node:fs";
import { validateDesignMap, type DesignMap } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import {
  DESIGN_MAP_VARIANTS_SCHEMA,
  KitIndexResolver,
  resolveDesignMapVariants,
  type DesignMapVariants,
  type KitIndex,
} from "../src/index.js";

const kitIndex = JSON.parse(
  readFileSync(new URL("./fixtures/m3-kit-index.json", import.meta.url), "utf8"),
) as KitIndex;

const FILE = kitIndex.fileKey;
const ref = (nodeId: string): string => `figma:${FILE}/${nodeId}`;
const resolver = new KitIndexResolver(kitIndex);

const CODE = "catalog/Catalog.kt#FilledButton";

/** A one-component map whose single entry is the base reference. */
function mapWith(reference: string, code = CODE): DesignMap {
  return {
    components: [
      {
        code,
        source: "figma",
        ref: reference,
        previewId: "c.CatalogKt.FilledButton_Light",
      },
    ],
  };
}

function sidecar(
  reference: string,
  renders: DesignMapVariants["components"][number]["renders"],
  code = CODE,
): DesignMapVariants {
  return {
    schema: DESIGN_MAP_VARIANTS_SCHEMA,
    components: [
      {
        code,
        componentId: "Button/Filled",
        reference,
        basePreviewId: "c.CatalogKt.FilledButton_Light",
        renders,
      },
    ],
  };
}

describe("folding resolved variants into the map", () => {
  const { map, diagnostics } = resolveDesignMapVariants({
    map: mapWith(ref("57994:2324")),
    variants: sidecar(ref("57994:2324"), [
      {
        previewId: "c.CatalogKt.FilledButton_Light_VARIANT_l-square",
        name: "l-square",
        seeds: [
          { key: "size", raw: "l" },
          { key: "shape", raw: "square" },
        ],
      },
    ]),
    resolver,
  });
  const entry = map.components[0]!;

  it("keeps the base ref first and appends the resolved variant", () => {
    expect(entry.ref).toEqual([
      { ref: ref("57994:2324") },
      { ref: ref("57994:2310"), state: "l-square" },
    ]);
  });

  it("pairs preview ids slot for slot with the refs", () => {
    // design-parity matches the two lists positionally, so a slot present on
    // one side and absent on the other silently mis-pairs a render.
    expect(entry.previewId).toEqual([
      { previewId: "c.CatalogKt.FilledButton_Light" },
      {
        previewId: "c.CatalogKt.FilledButton_Light_VARIANT_l-square",
        state: "l-square",
      },
    ]);
  });

  it("emits a map that validates against the design-map schema", () => {
    expect(validateDesignMap(map)).toEqual({ valid: true, errors: [] });
  });

  it("counts what it folded in", () => {
    expect(diagnostics.resolved).toBe(1);
    expect(diagnostics.components).toBe(1);
  });
});

describe("slot tagging", () => {
  it("tags a lone size knob as a size slot, not a state", () => {
    const { map } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(ref("57994:2324"), [
        {
          previewId: "p:l",
          name: "l",
          seeds: [{ key: "size", raw: "l" }],
        },
      ]),
      resolver,
    });
    expect(map.components[0]!.ref).toEqual([
      { ref: ref("57994:2324") },
      { ref: ref("57994:2320"), size: "l" },
    ]);
  });
});

describe("misses, reported apart", () => {
  it("reports a property-shaped variant rather than guessing a node", () => {
    const { map, diagnostics } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(ref("57994:2324"), [
        { previewId: "p:icon", name: "icon", seeds: [{ key: "icon", raw: "true" }] },
      ]),
      resolver,
    });
    expect(diagnostics.propertyVariants).toHaveLength(1);
    expect(diagnostics.propertyVariants[0]).toMatchObject({
      componentId: "Button/Filled",
      variant: "icon",
      vector: "icon=true",
      setName: "Button",
    });
    expect(diagnostics.unresolved).toEqual([]);
    // Unpaired means the entry stays a plain string, not a list of one.
    expect(map.components[0]!.ref).toBe(ref("57994:2324"));
  });

  it("reports a variant the kit models neither way", () => {
    const { diagnostics } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(ref("57994:2324"), [
        { previewId: "p:x", name: "x", seeds: [{ key: "elevation", raw: "3" }] },
      ]),
      resolver,
    });
    expect(diagnostics.unresolved).toEqual([
      {
        code: CODE,
        componentId: "Button/Filled",
        variant: "x",
        vector: "elevation=3",
      },
    ]);
    expect(diagnostics.propertyVariants).toEqual([]);
  });

  it("names the optional content a reference draws by default", () => {
    const { diagnostics } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(ref("57994:2324"), []),
      resolver,
    });
    expect(diagnostics.defaulted[0]).toMatchObject({
      componentId: "Button/Filled",
      setName: "Button",
    });
    expect(diagnostics.defaulted[0]!.properties).toContain("Show icon");
  });
});

describe("collisions", () => {
  it("drops and reports two variants resolving to one node", () => {
    // The same node cannot be both previews' counterpart. Emitting it would
    // have the diff compare two different renders against one reference and
    // call one of them wrong.
    const { map, diagnostics } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(ref("57994:2324"), [
        { previewId: "p:a", name: "a", seeds: [{ key: "size", raw: "l" }] },
        { previewId: "p:b", name: "b", seeds: [{ key: "size", raw: "large" }] },
      ]),
      resolver,
    });
    expect(diagnostics.collisions).toEqual([
      {
        code: CODE,
        componentId: "Button/Filled",
        ref: ref("57994:2320"),
        owner: "a",
        duplicate: "b",
      },
    ]);
    // The first owner survives; the duplicate is not in the map.
    expect((map.components[0]!.ref as { ref: string }[]).map((r) => r.ref)).toEqual([
      ref("57994:2324"),
      ref("57994:2320"),
    ]);
  });
});

describe("hidden component sets", () => {
  it("uses the renderable alias for the base ref, not the definition", () => {
    // A hidden set's definition exports as a placeholder. The original
    // projection applied the alias only when a component had variants, so a
    // hidden-set component with none kept an unrenderable ref.
    const { map } = resolveDesignMapVariants({
      map: mapWith(ref("53977:33611")),
      variants: sidecar(ref("53977:33611"), []),
      resolver,
    });
    expect(map.components[0]!.ref).toBe(ref("53977:34289"));
  });
});

describe("inputs it refuses or leaves alone", () => {
  it("throws on a sidecar written to a different schema", () => {
    // Guessing would emit a map of base refs alone — indistinguishable from a
    // kit that resolved nothing.
    expect(() =>
      resolveDesignMapVariants({
        map: mapWith(ref("57994:2324")),
        variants: { schema: "something/v2", components: [] },
        resolver,
      }),
    ).toThrow(/unsupported variant sidecar schema/);
  });

  it("leaves an entry whose ref is already a tagged list untouched", () => {
    const map: DesignMap = {
      components: [
        {
          code: CODE,
          source: "figma",
          ref: [{ ref: ref("1:1"), state: "hand-authored" }],
          previewId: [{ previewId: "p:1", state: "hand-authored" }],
        },
      ],
    };
    const result = resolveDesignMapVariants({
      map,
      variants: sidecar(ref("57994:2324"), [
        { previewId: "p:l", name: "l", seeds: [{ key: "size", raw: "l" }] },
      ]),
      resolver,
    });
    expect(result.map.components[0]!.ref).toEqual([
      { ref: ref("1:1"), state: "hand-authored" },
    ]);
    expect(result.diagnostics.resolved).toBe(0);
  });

  it("reports a declaration the map has no entry for", () => {
    const { diagnostics } = resolveDesignMapVariants({
      map: mapWith(ref("57994:2324")),
      variants: sidecar(
        ref("57994:2324"),
        [{ previewId: "p:l", name: "l", seeds: [{ key: "size", raw: "l" }] }],
        "catalog/Gone.kt#Removed",
      ),
      resolver,
    });
    expect(diagnostics.orphaned).toEqual(["catalog/Gone.kt#Removed"]);
  });

  it("does not mutate the input map", () => {
    const input = mapWith(ref("57994:2324"));
    resolveDesignMapVariants({
      map: input,
      variants: sidecar(ref("57994:2324"), [
        { previewId: "p:l", name: "l", seeds: [{ key: "size", raw: "l" }] },
      ]),
      resolver,
    });
    expect(input.components[0]!.ref).toBe(ref("57994:2324"));
  });
});
