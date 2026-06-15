import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  loadDesignMap,
  validateDesignMap,
  designMapSchema,
  findByCode,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

describe("design-map schema", () => {
  it("exposes a draft-07 schema", () => {
    expect(designMapSchema.$schema).toContain("draft-07");
  });

  it("validates the fixture design-map", async () => {
    const map = await loadDesignMap(fixture("fixtures/design-map.json"));
    expect(map.components.length).toBe(3);
    expect(findByCode(map, "ui/Button.kt#PrimaryButton")?.source).toBe("figma");
  });

  it("validates the example design-map", async () => {
    const map = await loadDesignMap(fixture("examples/design-map.json"));
    expect(map.components.length).toBeGreaterThan(0);
  });

  it("rejects an unknown source", () => {
    const r = validateDesignMap({
      components: [{ code: "a#b", source: "sketch", ref: "x" }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/source/);
  });

  it("rejects a code handle without a member ref", () => {
    const r = validateDesignMap({
      components: [{ code: "ui/Button.kt", source: "figma", ref: "x" }],
    });
    expect(r.valid).toBe(false);
  });

  it("rejects extra top-level keys", () => {
    const r = validateDesignMap({ components: [], extra: true });
    expect(r.valid).toBe(false);
  });

  it("accepts a tokens alias section", () => {
    const r = validateDesignMap({
      components: [],
      tokens: {
        colors: { onSurface: "color/on-surface" },
        typography: { bodyLarge: "type/body/large" },
        spacing: { gutter: "space/gutter" },
        radius: { card: "radius/card" },
      },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects an unknown token kind", () => {
    const r = validateDesignMap({
      components: [],
      tokens: { shadows: { card: "elevation/card" } },
    });
    expect(r.valid).toBe(false);
  });

  it("rejects a non-string alias target", () => {
    const r = validateDesignMap({
      components: [],
      tokens: { colors: { onSurface: 42 } },
    });
    expect(r.valid).toBe(false);
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadDesignMap(fixture("nope.json"))).rejects.toThrow(
      /cannot read/,
    );
  });
});
