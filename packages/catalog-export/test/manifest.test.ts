import { describe, expect, it } from "vitest";

import type { Image } from "@design-parity/core";

import { imagePath, slug, toCatalogManifest } from "../src/manifest.js";
import type { Catalog } from "../src/types.js";

describe("slug", () => {
  it("lowercases and replaces unsafe runs, never empty", () => {
    expect(slug("Button/Filled")).toBe("button-filled");
    expect(slug("  weird **name** ")).toBe("weird-name");
    expect(slug("***")).toBe("x");
    expect(slug("a_b.c-d")).toBe("a_b.c-d");
  });
});

describe("imagePath", () => {
  it("encodes component, variant, and every present variant key", () => {
    const image: Image = { state: "pressed", theme: "dark", size: "compact", uri: "x", width: 1, height: 1 };
    expect(imagePath("Button/Filled", "ideal", image)).toBe(
      "images/button-filled/ideal__pressed__dark__compact.png",
    );
  });

  it("omits absent keys", () => {
    const image: Image = { state: "default", uri: "x", width: 1, height: 1 };
    expect(imagePath("Card", "layout", image)).toBe("images/card/layout__default.png");
  });
});

describe("toCatalogManifest", () => {
  const catalog: Catalog = {
    meta: {
      system: "compose-m3",
      title: "Compose Material 3",
      library: ["androidx.compose.material3:material3"],
      renderer: "compose-preview 0.16.2",
    },
    themeTokens: { colors: { primary: "#6750a4" } },
    components: [
      {
        componentId: "Button/Filled",
        group: "Buttons",
        caption: "Primary action",
        reference: { source: "figma", url: "https://figma.com/..." },
        variants: {
          ideal: [{ state: "default", theme: "light", uri: "a", width: 100, height: 48 }],
          layout: [{ state: "default", theme: "light", uri: "b", width: 100, height: 48 }],
        },
        tokens: { radius: { container: 20 } },
        greenlines: [{ kind: "a11y", severity: "info", message: 'button "Save"' }],
      },
    ],
  };

  it("emits schema, provenance, and a tokensFile when themeTokens are present", () => {
    const m = toCatalogManifest(catalog);
    expect(m.schema).toBe("design-parity-catalog/v1");
    expect(m.system).toBe("compose-m3");
    expect(m.library).toEqual(["androidx.compose.material3:material3"]);
    expect(m.tokensFile).toBe("tokens.dtcg.json");
  });

  it("lists both variants with stable paths and preserves component fields", () => {
    const c = toCatalogManifest(catalog).components[0]!;
    expect(c.images.map((i) => [i.variant, i.path])).toEqual([
      ["ideal", "images/button-filled/ideal__default__light.png"],
      ["layout", "images/button-filled/layout__default__light.png"],
    ]);
    expect(c.group).toBe("Buttons");
    expect(c.caption).toBe("Primary action");
    expect(c.reference?.source).toBe("figma");
    expect(c.tokens).toEqual({ radius: { container: 20 } });
    expect(c.greenlines).toHaveLength(1);
  });

  it("honours a custom tokens filename and omits it without themeTokens", () => {
    expect(toCatalogManifest(catalog, { tokensFile: "t.json" }).tokensFile).toBe("t.json");
    const noTokens: Catalog = { meta: catalog.meta, components: catalog.components };
    expect(toCatalogManifest(noTokens).tokensFile).toBeUndefined();
  });
});
