import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  loadDesignMap,
  validateDesignMap,
  designMapSchema,
  findByCode,
  findAllByCode,
  entryRefs,
  entryPreviewIds,
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

  it("accepts a component declaring a DTCG tokensFile (issue #89)", () => {
    const r = validateDesignMap({
      components: [
        { code: "a#b", source: "bundle", ref: "x", tokensFile: "design/a.tokens.json" },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("accepts a component declaring its reference board's density (issue #279)", () => {
    const r = validateDesignMap({
      components: [{ code: "a#b", source: "figma", ref: "figma:k/1-2", density: 3 }],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a non-positive density — it would divide every spec by zero or flip it", () => {
    for (const density of [0, -3]) {
      const r = validateDesignMap({
        components: [{ code: "a#b", source: "figma", ref: "figma:k/1-2", density }],
      });
      expect(r.valid).toBe(false);
    }
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

  it("accepts a variant-list ref binding several nodes", () => {
    const r = validateDesignMap({
      components: [
        {
          code: "ui/Device.kt#DeviceScreen",
          source: "figma",
          ref: [
            { ref: "figma:KEY/1:10", state: "default" },
            { ref: "figma:KEY/1:20", theme: "dark" },
            { ref: "figma:KEY/1:30", size: "compact" },
          ],
        },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a variant missing its ref", () => {
    const r = validateDesignMap({
      components: [{ code: "a#b", source: "figma", ref: [{ state: "default" }] }],
    });
    expect(r.valid).toBe(false);
  });

  it("rejects an unknown variant theme", () => {
    const r = validateDesignMap({
      components: [
        { code: "a#b", source: "figma", ref: [{ ref: "x", theme: "sepia" }] },
      ],
    });
    expect(r.valid).toBe(false);
  });

  it("rejects an empty variant list", () => {
    const r = validateDesignMap({
      components: [{ code: "a#b", source: "figma", ref: [] }],
    });
    expect(r.valid).toBe(false);
  });

  it("normalizes string and list refs via entryRefs", () => {
    expect(entryRefs({ code: "a#b", source: "figma", ref: "figma:K/1:1" })).toEqual([
      { ref: "figma:K/1:1" },
    ]);
    const list = [
      { ref: "figma:K/1:1", state: "default" },
      { ref: "figma:K/1:2", theme: "dark" as const },
    ];
    expect(entryRefs({ code: "a#b", source: "figma", ref: list })).toEqual(list);
  });

  it("accepts a previewId variant list (#111)", () => {
    const r = validateDesignMap({
      components: [
        {
          code: "ui/Device.kt#DeviceBody",
          source: "claude-design",
          ref: "design/Device.html",
          previewId: [
            { previewId: "app.DeviceKt.DeviceBodyPreview", theme: "light" },
            { previewId: "app.DeviceKt.DeviceBodyDarkPreview", theme: "dark" },
          ],
        },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("accepts exact per-visual known-difference scopes", () => {
    const r = validateDesignMap({
      components: [{
        code: "ui/Icon.kt#Tonal",
        source: "figma",
        ref: "figma:K/1:2",
        knownDifferences: {
          "default/light": {
            system: "m3",
            component: "IconButton/Tonal",
            previewId: "iconbutton-tonal__ideal__default__light",
            referenceId: "iconbutton-tonal-ideal-light",
            variant: "ideal/default/light",
            overrides: {},
          },
        },
      }],
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("accepts a per-reference Figma contents-only override", () => {
    const r = validateDesignMap({
      components: [
        {
          code: "ui/Search.kt#ExpandedSearch",
          source: "figma",
          ref: "figma:K/1:2",
          referenceContentsOnly: false,
        },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a previewId variant missing its handle (#111)", () => {
    const r = validateDesignMap({
      components: [
        {
          code: "a#b",
          source: "bundle",
          ref: "x",
          previewId: [{ theme: "dark" }],
        },
      ],
    });
    expect(r.valid).toBe(false);
  });

  it("normalizes absent/string/list previewIds via entryPreviewIds (#111)", () => {
    // Absent → empty list.
    expect(entryPreviewIds({ code: "a#b", source: "bundle", ref: "x" })).toEqual([]);
    // String shorthand → one untagged variant.
    expect(
      entryPreviewIds({ code: "a#b", source: "bundle", ref: "x", previewId: "p.Q.r" }),
    ).toEqual([{ previewId: "p.Q.r" }]);
    // List → passed through untouched.
    const list = [
      { previewId: "p.Q.light", theme: "light" as const },
      { previewId: "p.Q.dark", theme: "dark" as const },
    ];
    expect(
      entryPreviewIds({ code: "a#b", source: "bundle", ref: "x", previewId: list }),
    ).toEqual(list);
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadDesignMap(fixture("nope.json"))).rejects.toThrow(
      /cannot read/,
    );
  });

  it("findAllByCode returns every entry for a code, in order (#106)", () => {
    const map = {
      components: [
        { code: "ui/Card.kt#OfferCard", source: "stitch" as const, ref: "stitch:a" },
        { code: "ui/Button.kt#Primary", source: "figma" as const, ref: "figma:K/1:1" },
        {
          code: "ui/Card.kt#OfferCard",
          source: "claude-design" as const,
          ref: "design/offer.html",
        },
      ],
    };
    // findByCode still returns just the first match…
    expect(findByCode(map, "ui/Card.kt#OfferCard")?.source).toBe("stitch");
    // …while findAllByCode returns both same-code entries in declaration order.
    expect(findAllByCode(map, "ui/Card.kt#OfferCard").map((e) => e.source)).toEqual([
      "stitch",
      "claude-design",
    ]);
    expect(findAllByCode(map, "ui/Button.kt#Primary")).toHaveLength(1);
    expect(findAllByCode(map, "nope#none")).toEqual([]);
  });
});
