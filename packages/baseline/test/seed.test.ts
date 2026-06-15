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
const annotated = fileURLToPath(
  new URL("./fixtures/annotated/", import.meta.url),
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

describe("@DesignRef harvest", () => {
  it("captures an authored ref (annotation + comment) as a high-confidence link", async () => {
    const found = await discoverCodeComponents(resolve(annotated));
    const byCode = new Map(found.map((c) => [c.code, c]));

    const device = byCode.get("ui/Device.kt#DeviceScreen");
    expect(device).toMatchObject({ ref: "figma:KEY123/10:2", confidence: "high" });

    const tile = byCode.get("web/Tile.tsx#OfferTile");
    expect(tile).toMatchObject({ ref: "stitch:proj/screen-1", confidence: "high" });

    // An unannotated component stays a low-confidence review item.
    expect(byCode.get("ui/Device.kt#PlainCard")).toMatchObject({
      confidence: "low",
    });
    expect(byCode.get("ui/Device.kt#PlainCard")?.ref).toBeUndefined();
  });
});

describe("seedDesignMap", () => {
  it("produces a schema-valid (empty) starter map with no input", () => {
    const map = seedDesignMap();
    expect(validateDesignMap(map).valid).toBe(true);
    expect(map.components).toEqual([]);
  });

  it("emits real entries for authored refs, inferring the source", () => {
    const map = seedDesignMap([
      { code: "ui/A.kt#A", symbol: "A", file: "ui/A.kt", ref: "figma:K/1:2", confidence: "high" },
      { code: "ui/B.kt#B", symbol: "B", file: "ui/B.kt", ref: "stitch:p/s", confidence: "high" },
      { code: "ui/C.kt#C", symbol: "C", file: "ui/C.kt", ref: "design/c.html", confidence: "high" },
      { code: "ui/D.kt#D", symbol: "D", file: "ui/D.kt", ref: "mocks/d", confidence: "high" },
      // No ref → not in the manifest (stays a review item).
      { code: "ui/E.kt#E", symbol: "E", file: "ui/E.kt", confidence: "low" },
    ]);
    expect(validateDesignMap(map).valid).toBe(true);
    expect(map.components).toEqual([
      { code: "ui/A.kt#A", source: "figma", ref: "figma:K/1:2" },
      { code: "ui/B.kt#B", source: "stitch", ref: "stitch:p/s" },
      { code: "ui/C.kt#C", source: "claude-design", ref: "design/c.html" },
      { code: "ui/D.kt#D", source: "bundle", ref: "mocks/d" },
    ]);
  });
});
