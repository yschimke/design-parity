import { describe, it, expect } from "vitest";

import { referenceProperties, propertyName } from "../src/properties.js";
import {
  canonicalAxis,
  formatVariantName,
  parseVariantName,
  sameAxes,
} from "../src/variant-name.js";
import type { FigmaNodeDoc } from "../src/figma-api.js";

/** The M3 kit's shape: variant axes on the set, plus a silent `Show icon`. */
const buttonSet: FigmaNodeDoc = {
  id: "10:1",
  name: "Button",
  type: "COMPONENT_SET",
  componentPropertyDefinitions: {
    Type: { type: "VARIANT", defaultValue: "Round", variantOptions: ["Round", "Square"] },
    Size: {
      type: "VARIANT",
      defaultValue: "Small",
      variantOptions: ["Small", "Medium", "Large"],
    },
    "Show icon#5590:0": { type: "BOOLEAN", defaultValue: true },
    "Label#5590:1": { type: "TEXT", defaultValue: "Button" },
  },
  children: [
    { id: "10:2", name: "Type=Round, Size=Small", type: "COMPONENT" },
    { id: "10:3", name: "Type=Round, Size=Medium", type: "COMPONENT" },
    { id: "10:4", name: "Type=Square, Size=Small", type: "COMPONENT" },
  ],
};

const smallVariant: FigmaNodeDoc = {
  id: "10:2",
  name: "Type=Round, Size=Small",
  type: "COMPONENT",
};

describe("propertyName", () => {
  it("strips Figma's id suffix", () => {
    expect(propertyName("Show icon#5590:0")).toBe("Show icon");
  });

  it("leaves a bare name alone", () => {
    expect(propertyName("Size")).toBe("Size");
  });
});

describe("parseVariantName", () => {
  it("reads a variant name as an axis vector", () => {
    expect([...parseVariantName("Type=Round, Size=Small")]).toEqual([
      ["Type", "Round"],
      ["Size", "Small"],
    ]);
  });

  it("returns nothing for a name that is not an axis vector", () => {
    expect(parseVariantName("Button/Primary").size).toBe(0);
  });

  it("round-trips through formatVariantName", () => {
    const axes = parseVariantName("Type=Round, Size=Small");
    expect(formatVariantName(axes)).toBe("Type=Round, Size=Small");
  });

  it("matches axis names case-insensitively, answering in the source's spelling", () => {
    const axes = parseVariantName("Type=Round, Size=Small");
    expect(canonicalAxis(axes.keys(), "size")).toBe("Size");
    expect(canonicalAxis(axes.keys(), "density")).toBeUndefined();
  });

  it("compares vectors regardless of order", () => {
    expect(
      sameAxes(
        parseVariantName("Size=Small, Type=Round"),
        parseVariantName("Type=Round, Size=Small"),
      ),
    ).toBe(true);
    expect(
      sameAxes(
        parseVariantName("Type=Round, Size=Small"),
        parseVariantName("Type=Round, Size=Medium"),
      ),
    ).toBe(false);
  });
});

describe("referenceProperties", () => {
  it("reports what the render depicts, not just what the name says", () => {
    expect(referenceProperties(smallVariant, buttonSet)).toEqual([
      { name: "Label", type: "text", value: "Button" },
      {
        name: "Show icon",
        type: "boolean",
        value: "true", // the default `/v1/images` renders with — invisible in the name
      },
      {
        name: "Size",
        type: "variant",
        value: "Small",
        options: ["Small", "Medium", "Large"],
      },
      {
        name: "Type",
        type: "variant",
        value: "Round",
        options: ["Round", "Square"],
      },
    ]);
  });

  it("prefers the variant's own axis values over the set's defaults", () => {
    const medium = { ...smallVariant, id: "10:3", name: "Type=Round, Size=Medium" };
    const size = referenceProperties(medium, buttonSet).find((p) => p.name === "Size");
    expect(size?.value).toBe("Medium"); // not the set's "Small"
  });

  it("reads definitions off the node itself for a standalone component", () => {
    const standalone: FigmaNodeDoc = {
      id: "20:1",
      name: "Badge",
      type: "COMPONENT",
      componentPropertyDefinitions: {
        "Show count#1:0": { type: "BOOLEAN", defaultValue: false },
      },
    };
    expect(referenceProperties(standalone)).toEqual([
      { name: "Show count", type: "boolean", value: "false" },
    ]);
  });

  it("says nothing for a node that declares nothing", () => {
    expect(referenceProperties({ id: "1:1", name: "Frame", type: "FRAME" })).toEqual([]);
  });
});
