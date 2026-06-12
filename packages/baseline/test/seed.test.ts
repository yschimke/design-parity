import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  discoverCodeComponents,
  seedDesignMap,
} from "../src/index.js";
import { validateDesignMap } from "@design-parity/core";

const greenfield = fileURLToPath(
  new URL("./fixtures/rung3-greenfield/", import.meta.url),
);

describe("discoverCodeComponents", () => {
  it("finds Compose and React components by convention, low confidence", async () => {
    const found = await discoverCodeComponents(resolve(greenfield));
    const codes = found.map((c) => c.code);
    expect(codes).toContain("ui/Button.kt#PrimaryButton");
    expect(codes).toContain("ui/Button.kt#SecondaryButton");
    expect(codes).toContain("web/components/Card.tsx#OfferCard");
    expect(codes).toContain("web/components/Card.tsx#PriceTag");
    expect(found.every((c) => c.confidence === "low")).toBe(true);
  });

  it("ignores non-component (lowercase) symbols", async () => {
    const found = await discoverCodeComponents(resolve(greenfield));
    const symbols = found.map((c) => c.symbol);
    expect(symbols).not.toContain("helper");
    expect(symbols).not.toContain("formatPrice");
  });

  it("returns results sorted by code handle", async () => {
    const found = await discoverCodeComponents(resolve(greenfield));
    const codes = found.map((c) => c.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });
});

describe("seedDesignMap", () => {
  it("produces a schema-valid (empty) starter map", () => {
    const map = seedDesignMap();
    expect(validateDesignMap(map).valid).toBe(true);
    expect(map.components).toEqual([]);
  });
});
