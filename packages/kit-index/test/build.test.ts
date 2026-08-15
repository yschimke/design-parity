/**
 * Projecting the committed index: what gets kept, and what a set's properties
 * and instances become once the definitions arrive.
 */
import { describe, expect, it } from "vitest";

import {
  attachProperties,
  buildSkeleton,
  referencedNodeIds,
  type InventoryInstance,
  type KitInventory,
  type KitSet,
} from "../src/index.js";

const FILE = "kitFile";

function inventory(partial: Partial<KitInventory["pages"][number]>): KitInventory {
  return {
    fileKey: FILE,
    depth: 8,
    mapped: [],
    pages: [
      {
        page: "Buttons",
        pageId: "page",
        deepest: 3,
        components: [],
        renderInstances: [],
        propertyInstances: [],
        ...partial,
      },
    ],
  };
}

const component = (
  partial: Partial<KitInventory["pages"][number]["components"][number]> & {
    id: string;
    name: string;
  },
) => ({
  type: "COMPONENT_SET" as const,
  level: 1,
  hidden: false,
  w: 100,
  h: 40,
  radius: null,
  trail: "",
  children: [],
  ...partial,
});

describe("referencedNodeIds", () => {
  it("reads both the string and the tagged-list form of a ref", () => {
    const ids = referencedNodeIds(
      {
        components: [
          { code: "a", source: "figma", ref: `figma:${FILE}/1:1` },
          {
            code: "b",
            source: "figma",
            ref: [
              { ref: `figma:${FILE}/2:2`, state: "pressed" },
              { ref: `figma:${FILE}/3:3`, size: "large" },
            ],
          },
        ],
      },
      FILE,
    );
    expect([...ids].sort()).toEqual(["1:1", "2:2", "3:3"]);
  });

  it("skips refs belonging to another file or another source", () => {
    // A repo may map some components to one kit and some to another; an index
    // is always about one file, and node ids are unique only within one.
    const ids = referencedNodeIds(
      {
        components: [
          { code: "a", source: "figma", ref: `figma:otherFile/1:1` },
          { code: "b", source: "stitch", ref: "stitch:screen/home" },
          { code: "c", source: "figma", ref: `figma:${FILE}/4:4` },
        ],
      },
      FILE,
    );
    expect([...ids]).toEqual(["4:4"]);
  });
});

describe("buildSkeleton", () => {
  it("keeps the whole set when a ref names one of its variants", () => {
    // The set is the vocabulary: without its siblings there is nothing to
    // resolve a knob against.
    const { sets } = buildSkeleton(
      inventory({
        components: [
          component({
            id: "set:button",
            name: "Button",
            children: [
              { id: "v:1", name: "State=Enabled", w: 1, h: 1, radius: null },
              { id: "v:2", name: "State=Disabled", w: 1, h: 1, radius: null },
            ],
          }),
          component({ id: "set:other", name: "Chip", children: [] }),
        ],
      }),
      new Set(["v:1"]),
    );
    expect(Object.keys(sets)).toEqual(["set:button"]);
    expect(sets["set:button"]?.variants.map((v) => v.id)).toEqual(["v:1", "v:2"]);
  });

  it("keeps a standalone component's folder siblings as its vocabulary", () => {
    const { standalone } = buildSkeleton(
      inventory({
        components: [
          component({ id: "d:full", name: "Horizontal/Full-width", type: "COMPONENT" }),
          component({ id: "d:inset", name: "Horizontal/Inset", type: "COMPONENT" }),
          component({ id: "x:other", name: "Vertical/Inset", type: "COMPONENT" }),
        ],
      }),
      new Set(["d:full"]),
    );
    expect(Object.keys(standalone).sort()).toEqual(["d:full", "d:inset"]);
  });

  it("aliases a hidden set's variants to their single visible example", () => {
    const { sets } = buildSkeleton(
      inventory({
        components: [
          component({
            id: "set:snack",
            name: "Snackbar",
            hidden: true,
            children: [{ id: "v:snack", name: "Lines=One", w: 1, h: 1, radius: null }],
          }),
        ],
        renderInstances: [
          {
            id: "i:example",
            componentId: "v:snack",
            name: "Snackbar",
            properties: {},
            trail: "Examples",
            example: true,
            w: 1,
            h: 1,
          },
        ],
      }),
      new Set(["v:snack"]),
    );
    expect(sets["set:snack"]?.variants[0]?.renderId).toBe("i:example");
  });

  it("does not alias when the kit offers more than one example", () => {
    // Two candidates make the choice arbitrary, and an arbitrary render handle
    // is a reference nobody can reason about.
    const example = (id: string): InventoryInstance => ({
      id,
      componentId: "v:snack",
      name: "Snackbar",
      properties: {},
      trail: "Examples",
      example: true,
      w: 1,
      h: 1,
    });
    const { sets } = buildSkeleton(
      inventory({
        components: [
          component({
            id: "set:snack",
            name: "Snackbar",
            hidden: true,
            children: [{ id: "v:snack", name: "Lines=One", w: 1, h: 1, radius: null }],
          }),
        ],
        renderInstances: [example("i:a"), example("i:b")],
      }),
      new Set(["v:snack"]),
    );
    expect(sets["set:snack"]?.variants[0]?.renderId).toBeUndefined();
  });

  it("reports a referenced node that is no component as a specimen", () => {
    const { specimenIds, sets, standalone } = buildSkeleton(
      inventory({ components: [] }),
      new Set(["9:9"]),
    );
    expect(specimenIds).toEqual(["9:9"]);
    expect(sets).toEqual({});
    expect(standalone).toEqual({});
  });
});

describe("attachProperties", () => {
  const set = (): KitSet => ({
    name: "Button",
    variants: [{ id: "v:enabled", name: "State=Enabled" }],
  });

  const instance = (
    id: string,
    properties: Record<string, boolean | string>,
    extra: Partial<InventoryInstance> = {},
  ): InventoryInstance => ({
    id,
    componentId: "v:enabled",
    name: "Button",
    properties: Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [
        k,
        { type: typeof v === "boolean" ? "BOOLEAN" : "TEXT", value: v },
      ]),
    ),
    trail: "",
    example: false,
    w: 100,
    h: 40,
    ...extra,
  });

  it("strips the id suffix and drops variant axes from the definitions", () => {
    const target = set();
    attachProperties(
      target,
      {
        "Show icon#1:0": { type: "BOOLEAN", defaultValue: true },
        "State#2:0": { type: "VARIANT", defaultValue: "Enabled" },
      },
      [],
    );
    expect(target.properties).toEqual({
      "Show icon": { type: "BOOLEAN", default: true },
    });
  });

  it("records a complete vector, filling unset properties from the defaults", () => {
    // Complete rather than sparse, so a match is an equality check on the whole
    // vector and never an accident of which keys happened to be recorded.
    const target = set();
    attachProperties(
      target,
      {
        "Show icon#1:0": { type: "BOOLEAN", defaultValue: true },
        "Label#3:0": { type: "TEXT", defaultValue: "Label" },
      },
      [instance("i:1", { "Show icon": false })],
    );
    expect(target.instances).toEqual([
      {
        id: "i:1",
        componentId: "v:enabled",
        properties: { "Show icon": false, Label: "Label" },
      },
    ]);
  });

  it("keeps one handle per distinct vector, preferring an example then the smaller node", () => {
    const target = set();
    const { instances } = attachProperties(
      target,
      { "Show icon#1:0": { type: "BOOLEAN", defaultValue: true } },
      [
        instance("i:big", { "Show icon": false }, { w: 500, h: 200 }),
        instance("i:example", { "Show icon": false }, { example: true, w: 900, h: 900 }),
        instance("i:small", { "Show icon": false }, { w: 10, h: 10 }),
        instance("i:other", { "Show icon": true }),
      ],
    );
    expect(instances).toBe(2);
    expect(target.instances?.map((i) => i.id)).toEqual(["i:example", "i:other"]);
  });

  it("ignores instances of a variant outside this set", () => {
    const target = set();
    attachProperties(
      target,
      { "Show icon#1:0": { type: "BOOLEAN", defaultValue: true } },
      [instance("i:foreign", { "Show icon": false }, { componentId: "v:elsewhere" })],
    );
    expect(target.instances).toBeUndefined();
  });

  it("records nothing for a set whose only properties are variant axes", () => {
    const target = set();
    const added = attachProperties(
      target,
      { "State#2:0": { type: "VARIANT", defaultValue: "Enabled" } },
      [],
    );
    expect(added).toEqual({ properties: 0, instances: 0 });
    expect(target.properties).toBeUndefined();
  });
});
