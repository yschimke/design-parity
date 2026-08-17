/**
 * Pairing a property-shaped variant with a configured instance.
 *
 * Synthetic sets throughout, deliberately: the point of these cases is the
 * *rule* (a false boolean, a text override, a count spread over ordinal
 * switches, a swap that must not be guessed), and a hand-built set states the
 * rule without depending on which vectors a live kit happens to have placed on
 * a page today.
 */
import { describe, expect, it } from "vitest";

import {
  matchProperty,
  matchSeedProperty,
  resolvePropertyInstance,
  seededPropertyValue,
  type KitSet,
} from "../src/index.js";

describe("resolvePropertyInstance", () => {
  it("resolves false boolean and text properties to exact configured instances", () => {
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: {
        "Show icon": { type: "BOOLEAN", default: true },
        Label: { type: "TEXT", default: "Label" },
      },
      instances: [
        {
          id: "instance:label-only",
          componentId: "component:enabled",
          properties: { "Show icon": false, Label: "Save" },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:enabled", [
        { key: "icon", raw: "false" },
        { key: "label", raw: "Save" },
      ]),
    ).toEqual({
      nodeId: "instance:label-only",
      properties: { "Show icon": false, Label: "Save" },
    });
  });

  it("resolves a count across ordinal boolean properties as one exact vector", () => {
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: {
        "Show 1st trailing action": { type: "BOOLEAN", default: true },
        "Show 2nd trailing action": { type: "BOOLEAN", default: false },
        "Show 3rd trailing action": { type: "BOOLEAN", default: false },
      },
      instances: [
        {
          id: "instance:two-actions",
          componentId: "component:small",
          properties: {
            "Show 1st trailing action": true,
            "Show 2nd trailing action": true,
            "Show 3rd trailing action": false,
          },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:small", { key: "actions", raw: "2" })
        ?.nodeId,
    ).toBe("instance:two-actions");
  });

  it("does not guess an instance-swap property from a semantic seed", () => {
    // `leading=icon` says what the content means, not which component id
    // supplies it. An instance carrying *some* icon is not the same claim.
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: { "Leading icon": { type: "INSTANCE_SWAP", default: "icon:star" } },
      instances: [
        {
          id: "instance:icon",
          componentId: "component:enabled",
          properties: { "Leading icon": "icon:add" },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:enabled", {
        key: "leading",
        raw: "icon",
      }),
    ).toBeUndefined();
  });

  it("never pairs a slot, whatever the kit has placed in one", () => {
    // A slot names a region someone drops content into. A knob says what the
    // content means, never which node fills it, so there is nothing to match —
    // and the kit's own default is an opaque guid rather than a value.
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: {
        "Tab group": {
          type: "SLOT",
          default: { guid: { sessionID: -1, localID: -1 } },
        },
      },
      instances: [
        {
          id: "instance:tabs",
          componentId: "component:fixed",
          properties: { "Tab group": { guid: { sessionID: 1, localID: 2 } } },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:fixed", { key: "tab", raw: "3" }),
    ).toBeUndefined();
  });

  it("requires the instance to be of the named variant", () => {
    // The right property vector on the wrong variant is a different component.
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: { "Show icon": { type: "BOOLEAN", default: true } },
      instances: [
        {
          id: "instance:disabled-no-icon",
          componentId: "component:disabled",
          properties: { "Show icon": false },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:enabled", { key: "icon", raw: "false" }),
    ).toBeUndefined();
    expect(
      resolvePropertyInstance(set, "component:disabled", { key: "icon", raw: "false" })
        ?.nodeId,
    ).toBe("instance:disabled-no-icon");
  });

  it("matches the whole vector, not just the seeded properties", () => {
    // The instance has the wanted `Show icon`, but also a label nobody asked
    // for. Accepting it would silently diff against different content.
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: {
        "Show icon": { type: "BOOLEAN", default: true },
        Label: { type: "TEXT", default: "Label" },
      },
      instances: [
        {
          id: "instance:renamed",
          componentId: "component:enabled",
          properties: { "Show icon": false, Label: "Something else" },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:enabled", { key: "icon", raw: "false" }),
    ).toBeUndefined();
  });

  it("returns nothing when no seed names a property at all", () => {
    const set: Pick<KitSet, "properties" | "instances"> = {
      properties: { "Show icon": { type: "BOOLEAN", default: true } },
      instances: [
        {
          id: "instance:a",
          componentId: "component:enabled",
          properties: { "Show icon": true },
        },
      ],
    };
    expect(
      resolvePropertyInstance(set, "component:enabled", {
        key: "elevation",
        raw: "3",
      }),
    ).toBeUndefined();
  });

  it("returns nothing for a set with no properties or no instances", () => {
    expect(
      resolvePropertyInstance(undefined, "c", { key: "icon", raw: "false" }),
    ).toBeUndefined();
    expect(
      resolvePropertyInstance(
        { properties: { X: { type: "BOOLEAN", default: true } } },
        "c",
        { key: "x", raw: "false" },
      ),
    ).toBeUndefined();
  });
});

describe("matchProperty", () => {
  const properties = {
    "Show icon": { type: "BOOLEAN" as const, default: true },
    "Icon (selected)": { type: "INSTANCE_SWAP" as const, default: "icon:star" },
  };

  it("prefers the name minus its filler words over a longer qualified name", () => {
    expect(matchProperty(properties, "icon")?.map((p) => p.name)).toEqual([
      "Show icon",
    ]);
  });

  it("returns every property a single knob spans, rather than breaking the tie", () => {
    // A count over a family of ordinal switches is one knob and three
    // properties. Naming one of the three would misreport it as a single
    // switch, and the count would be silently wrong.
    const ordinals = {
      "Show 1st action": { type: "BOOLEAN" as const, default: true },
      "Show 2nd action": { type: "BOOLEAN" as const, default: false },
    };
    expect(matchProperty(ordinals, "action")?.map((p) => p.name)).toEqual([
      "Show 1st action",
      "Show 2nd action",
    ]);
  });

  it("returns undefined when nothing matches", () => {
    expect(matchProperty(properties, "elevation")).toBeUndefined();
    expect(matchProperty(undefined, "icon")).toBeUndefined();
  });
});

describe("seededPropertyValue", () => {
  const bool = { name: "Show icon", type: "BOOLEAN" as const, default: true };
  const text = { name: "Label", type: "TEXT" as const, default: "Label" };

  it("reads the usual truthy and falsy spellings", () => {
    for (const raw of ["true", "on", "yes", "1"]) {
      expect(seededPropertyValue(bool, { key: "icon", raw }, [bool])).toBe(true);
    }
    for (const raw of ["false", "off", "no", "0", "none"]) {
      expect(seededPropertyValue(bool, { key: "icon", raw }, [bool])).toBe(false);
    }
  });

  it("reads content words against a property that names an icon", () => {
    expect(seededPropertyValue(bool, { key: "content", raw: "label" }, [bool])).toBe(
      false,
    );
    expect(
      seededPropertyValue(bool, { key: "content", raw: "icon+label" }, [bool]),
    ).toBe(true);
  });

  it("spreads a count across ordinal switches", () => {
    const first = { name: "Show 1st action", type: "BOOLEAN" as const, default: true };
    const third = { name: "Show 3rd action", type: "BOOLEAN" as const, default: false };
    const peers = [first, third];
    expect(seededPropertyValue(first, { key: "actions", raw: "2" }, peers)).toBe(true);
    expect(seededPropertyValue(third, { key: "actions", raw: "2" }, peers)).toBe(false);
  });

  it("keeps a hidden text property at its default, and a lone one empty", () => {
    // With a sibling switch off, the text is not shown and its value is moot.
    expect(seededPropertyValue(text, { key: "label", raw: "off" }, [text, bool])).toBe(
      "Label",
    );
    // Alone, the empty string is how absence is expressed.
    expect(seededPropertyValue(text, { key: "label", raw: "off" }, [text])).toBe("");
  });

  it("gives no value for a boolean it cannot read", () => {
    expect(
      seededPropertyValue(bool, { key: "icon", raw: "somewhat" }, [bool]),
    ).toBeUndefined();
  });
});

describe("a seed that declares the kit's own names", () => {
  it("sets a property to the declared value, not the code's word for it", () => {
    // `hidden` is a word no table knows; `kitValue: "False"` is the kit's, and
    // it is what the switch should be set to.
    expect(
      seededPropertyValue({ name: "Show icon", type: "BOOLEAN", default: true }, {
        key: "content",
        raw: "hidden",
        kitValue: "False",
      }, []),
    ).toBe(false);
  });

  it("matches a declared property name exactly", () => {
    const properties = {
      "Show focus indicator": { type: "BOOLEAN", default: false },
      "Show icon": { type: "BOOLEAN", default: true },
    } as const;
    // The knob key keeps its latitude…
    expect(
      matchSeedProperty(properties, { key: "focus", raw: "true" })?.map((p) => p.name),
    ).toEqual(["Show focus indicator"]);
    // …and the declaration does not.
    expect(
      matchSeedProperty(properties, { key: "x", raw: "true", kitAxis: "focus" }),
    ).toBeUndefined();
    expect(
      matchSeedProperty(properties, {
        key: "x",
        raw: "true",
        kitAxis: "show focus indicator",
      })?.map((p) => p.name),
    ).toEqual(["Show focus indicator"]);
  });
});
