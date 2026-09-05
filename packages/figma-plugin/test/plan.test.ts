import type { CatalogManifest } from "@design-parity/catalog-export";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildImportPlan, imageKey, resolveImageUrl } from "../src/plan.js";

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  tokensFile: "tokens.dtcg.json",
  components: [
    {
      componentId: "Button/Filled",
      group: "Buttons",
      caption: "High-emphasis action",
      images: [
        {
          variant: "ideal",
          path: "images/button-filled/ideal__default__light.png",
          state: "default",
          theme: "light",
          width: 200,
          height: 80,
        },
        {
          variant: "ideal",
          path: "images/button-filled/ideal__default__dark.png",
          state: "default",
          theme: "dark",
          width: 200,
          height: 80,
        },
        {
          variant: "layout",
          path: "images/button-filled/layout__default__light.png",
          state: "default",
          theme: "light",
          width: 200,
          height: 80,
        },
      ],
      greenlines: [],
      redlines: [],
    },
    {
      componentId: "Button/Outlined",
      group: "Buttons",
      images: [
        {
          variant: "ideal",
          path: "images/button-outlined/ideal__default__light.png",
          state: "default",
          theme: "light",
          width: 200,
          height: 80,
        },
      ],
      greenlines: [],
      redlines: [],
    },
    {
      componentId: "Switch",
      // no group → falls into "Ungrouped"
      images: [
        {
          variant: "ideal",
          path: "images/switch/ideal__on__light.png",
          state: "on",
          theme: "light",
          width: 120,
          height: 60,
        },
      ],
      greenlines: [],
      redlines: [],
    },
  ],
};

describe("resolveImageUrl", () => {
  it("joins a relative path onto the base, normalizing slashes", () => {
    expect(resolveImageUrl("https://cdn.test/base/", "images/a.png")).toBe(
      "https://cdn.test/base/images/a.png",
    );
    expect(resolveImageUrl("https://cdn.test/base", "/images/a.png")).toBe(
      "https://cdn.test/base/images/a.png",
    );
  });

  it("passes absolute and data URLs through untouched", () => {
    expect(resolveImageUrl("https://cdn.test", "https://x/y.png")).toBe(
      "https://x/y.png",
    );
    expect(resolveImageUrl("https://cdn.test", "data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});

describe("imageKey", () => {
  it("joins the present variant dimensions with a middot", () => {
    expect(
      imageKey({
        variant: "ideal",
        path: "x.png",
        state: "default",
        theme: "dark",
        size: "compact",
        width: 1,
        height: 1,
      }),
    ).toBe("default · dark · compact");
  });

  it("omits absent dimensions", () => {
    expect(
      imageKey({ variant: "ideal", path: "x.png", state: "on", width: 1, height: 1 }),
    ).toBe("on");
  });
});

describe("buildImportPlan", () => {
  const base = "https://raw.githubusercontent.com/o/r/sha";

  it("buckets components by group in first-seen order, defaulting to Ungrouped", () => {
    const plan = buildImportPlan(manifest, { baseUrl: base });
    expect(plan.groups.map((g) => g.name)).toEqual(["Buttons", "Ungrouped"]);
    expect(plan.groups[0]!.components.map((c) => c.componentId)).toEqual([
      "Button/Filled",
      "Button/Outlined",
    ]);
    expect(plan.groups[1]!.components[0]!.componentId).toBe("Switch");
  });

  it("places only the ideal variant by default and resolves URLs", () => {
    const plan = buildImportPlan(manifest, { baseUrl: base });
    const filled = plan.groups[0]!.components[0]!;
    expect(filled.images).toHaveLength(2); // the layout variant is excluded
    expect(filled.images[0]!.url).toBe(
      `${base}/images/button-filled/ideal__default__light.png`,
    );
    expect(filled.images[0]!.key).toBe("default · light");
    expect(plan.imageCount).toBe(4);
  });

  it("selects the layout variant when requested", () => {
    const plan = buildImportPlan(manifest, { baseUrl: base, variant: "layout" });
    // only Button/Filled has a layout image
    expect(plan.imageCount).toBe(1);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.components[0]!.images[0]!.path).toBe(
      "images/button-filled/layout__default__light.png",
    );
  });

  it("projects theme tokens to a Figma variable collection when supplied", () => {
    const themeTokens: DesignTokens = {
      colors: { primary: "#6750A4", "surface.light": "#FFFBFE", "surface.dark": "#1C1B1F" },
      radius: { medium: 12 },
    };
    const plan = buildImportPlan(manifest, { baseUrl: base, themeTokens });
    expect(plan.collection).toBeDefined();
    expect(plan.collection!.name).toBe("Compose Material 3");
    const names = plan.collection!.variables.map((v) => v.name);
    expect(names).toContain("color/primary");
    expect(names).toContain("color/surface");
    expect(names).toContain("radius/medium");
    // surface is themed → light + dark modes present
    expect(Object.values(plan.collection!.modes).sort()).toEqual(["dark", "light"]);
  });

  it("omits the collection when no theme tokens are supplied", () => {
    const plan = buildImportPlan(manifest, { baseUrl: base });
    expect(plan.collection).toBeUndefined();
  });
});

const withGreenlines: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Small",
      group: "Buttons",
      images: [
        { variant: "ideal", path: "images/btn/ideal.png", state: "default", width: 100, height: 40 },
        { variant: "layout", path: "images/btn/layout.png", state: "default", width: 100, height: 40 },
      ],
      greenlines: [
        {
          kind: "a11y",
          severity: "error",
          message: "Touch target 40dp below 48dp minimum",
          bounds: { x: 0, y: 0, width: 100, height: 40 },
        },
        { kind: "a11y", severity: "info", message: "Role: button" },
      ],
      redlines: [],
    },
  ],
};

describe("buildImportPlan — greenlines", () => {
  const base = "https://x/y";

  it("carries the component greenlines and totals greenlineCount for the ideal variant", () => {
    const plan = buildImportPlan(withGreenlines, { baseUrl: base });
    expect(plan.greenlineCount).toBe(2);
    expect(plan.groups[0]!.components[0]!.greenlines).toHaveLength(2);
  });

  it("drops greenlines for the layout variant (they anchor to ideal pixel space)", () => {
    const plan = buildImportPlan(withGreenlines, { baseUrl: base, variant: "layout" });
    expect(plan.greenlineCount).toBe(0);
    expect(plan.groups[0]!.components[0]!.greenlines).toEqual([]);
  });

  it("drops greenlines when explicitly disabled", () => {
    const plan = buildImportPlan(withGreenlines, { baseUrl: base, greenlines: false });
    expect(plan.greenlineCount).toBe(0);
  });
});

const withRedlines: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Card",
      group: "Containers",
      images: [
        { variant: "ideal", path: "images/card/ideal.png", state: "default", width: 240, height: 120 },
        { variant: "layout", path: "images/card/layout.png", state: "default", width: 240, height: 120 },
      ],
      greenlines: [{ kind: "a11y", severity: "info", message: "Role: card" }],
      redlines: [
        {
          role: "Column",
          bounds: { x: 0, y: 0, width: 240, height: 120 },
          padding: { top: 16, end: 16, bottom: 16, start: 16 },
          gap: 8,
          cornerRadius: 12,
        },
      ],
    },
  ],
};

describe("buildImportPlan — redlines", () => {
  const base = "https://x/y";

  it("attaches redlines and totals redlineCount only for the layout variant", () => {
    const plan = buildImportPlan(withRedlines, { baseUrl: base, variant: "layout" });
    expect(plan.redlineCount).toBe(1);
    expect(plan.groups[0]!.components[0]!.redlines).toHaveLength(1);
    // greenlines are ideal-only, so none here
    expect(plan.greenlineCount).toBe(0);
  });

  it("drops redlines for the ideal variant (greenlines take that layer)", () => {
    const plan = buildImportPlan(withRedlines, { baseUrl: base });
    expect(plan.redlineCount).toBe(0);
    expect(plan.groups[0]!.components[0]!.redlines).toEqual([]);
    expect(plan.greenlineCount).toBe(1);
  });

  it("drops redlines when explicitly disabled on the layout variant", () => {
    const plan = buildImportPlan(withRedlines, {
      baseUrl: base,
      variant: "layout",
      redlines: false,
    });
    expect(plan.redlineCount).toBe(0);
  });
});

describe("buildImportPlan with alternate themes", () => {
  const tokens: DesignTokens = { colors: { "surface.light": "#fff", "surface.dark": "#000" } };
  const themes = [
    { id: "a.Electric", name: "Electric", dark: true, tokens: { colors: { surface: "#0ff" } } },
  ];

  it("gives each alternate theme a mode on the variable collection", () => {
    const plan = buildImportPlan(manifest, {
      baseUrl: "https://x",
      themeTokens: tokens,
      themes,
    });
    expect(Object.keys(plan.collection!.modes).sort()).toEqual(["a.Electric", "dark", "light"]);
    const surface = plan.collection!.variables.find((v) => v.name === "color/surface")!;
    expect(surface.valuesByMode["a.Electric"]).toBe("#0ff");
  });

  it("plans exactly as before when the catalog declares no themes", () => {
    const withThemes = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens, themes: [] });
    const without = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    expect(withThemes).toEqual(without);
  });

  it("ignores themes when the system set is absent, rather than inventing a collection", () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themes });
    expect(plan.collection).toBeUndefined();
  });
});
