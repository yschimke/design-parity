import { describe, expect, it } from "vitest";

import type { Image } from "@design-parity/core";

import {
  imagePath,
  livePreviewUrl,
  slug,
  themeTokensPath,
  toCatalogManifest,
} from "../src/manifest.js";
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
    const image: Image = {
      state: "pressed",
      theme: "dark",
      size: "compact",
      uri: "x",
      width: 1,
      height: 1,
    };
    expect(imagePath("Button/Filled", "ideal", image)).toBe(
      "images/button-filled/ideal__pressed__dark__compact.png",
    );
  });

  it("omits absent keys", () => {
    const image: Image = { state: "default", uri: "x", width: 1, height: 1 };
    expect(imagePath("Card", "layout", image)).toBe(
      "images/card/layout__default.png",
    );
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
        section: "Components",
        group: "Buttons",
        caption: "Primary action",
        reference: { source: "figma", url: "https://figma.com/..." },
        referenceSet: "figma:AbCdEf/58114:20565",
        noReference: "Kit publishes only the tonal variant; close enough to mislead.",
        variants: {
          ideal: [
            {
              state: "default",
              theme: "light",
              previewId: "com.example.ButtonKt.FilledButton",
              uri: "a",
              width: 100,
              height: 48,
            },
          ],
          layout: [
            {
              state: "default",
              theme: "light",
              uri: "b",
              width: 100,
              height: 48,
            },
          ],
        },
        tokens: { radius: { container: 20 } },
        greenlines: [
          { kind: "a11y", severity: "info", message: 'button "Save"' },
        ],
        redlines: [
          {
            bounds: { x: 0, y: 0, width: 100, height: 48 },
            padding: { start: 16, end: 16 },
          },
        ],
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
    expect(c.images[0]!.previewId).toBe("com.example.ButtonKt.FilledButton");
    expect(c.section).toBe("Components");
    expect(c.group).toBe("Buttons");
    expect(c.caption).toBe("Primary action");
    expect(c.reference?.source).toBe("figma");
    // The family handle has to survive onto the serialized manifest too, or the published
    // catalog.json drops it even though buildComponent kept it.
    expect(c.referenceSet).toBe("figma:AbCdEf/58114:20565");
    // Same for the stated-absence reason: it is the only signal separating "audited, kit has
    // nothing" from "nobody has looked", and it is worthless if it stops short of catalog.json.
    expect(c.noReference).toBe("Kit publishes only the tonal variant; close enough to mislead.");
    expect(c.tokens).toEqual({ radius: { container: 20 } });
    expect(c.greenlines).toHaveLength(1);
  });

  it("omits section when the component declares none", () => {
    const noSection: Catalog = {
      ...catalog,
      components: [
        { ...catalog.components[0]!, section: undefined },
        ...catalog.components.slice(1),
      ],
    };
    expect(toCatalogManifest(noSection).components[0]!.section).toBeUndefined();
  });

  it("carries display hints (surface + hero) through, omitting when absent", () => {
    expect(toCatalogManifest(catalog).display).toBeUndefined();
    const withDisplay: Catalog = {
      ...catalog,
      meta: { ...catalog.meta, display: { surface: "dark", hero: "Template/TimeText" } },
    };
    expect(toCatalogManifest(withDisplay).display).toEqual({
      surface: "dark",
      hero: "Template/TimeText",
    });
  });

  it("stamps the parity direction when given and omits it otherwise", () => {
    expect(toCatalogManifest(catalog).direction).toBeUndefined();
    expect(toCatalogManifest(catalog, { direction: "design-led" }).direction).toBe("design-led");
    expect(toCatalogManifest(catalog, { direction: "code-led" }).direction).toBe("code-led");
  });

  it("references a pre-generated wireframe SVG path when present", () => {
    expect(toCatalogManifest(catalog).components[0]!.wireframe).toBeUndefined();
    const withWire: Catalog = {
      ...catalog,
      components: [{ ...catalog.components[0]!, wireframeSvg: "<svg/>" }, ...catalog.components.slice(1)],
    };
    expect(toCatalogManifest(withWire).components[0]!.wireframe).toBe("wireframes/button-filled.svg");
  });

  it("carries the catalog's screen graph into the manifest", () => {
    expect(toCatalogManifest(catalog).screens).toBeUndefined();
    const screens = [{ id: "Button/Filled", title: "Primary", related: ["Button/Text"] }];
    const withScreens: Catalog = { ...catalog, meta: { ...catalog.meta, screens } };
    expect(toCatalogManifest(withScreens).screens).toEqual(screens);
  });

  it("honours a custom tokens filename and omits it without themeTokens", () => {
    expect(
      toCatalogManifest(catalog, { tokensFile: "t.json" }).tokensFile,
    ).toBe("t.json");
    const noTokens: Catalog = {
      meta: catalog.meta,
      components: catalog.components,
    };
    expect(toCatalogManifest(noTokens).tokensFile).toBeUndefined();
  });

  it("omits livePreview by default and emits a deep link when a server is configured", () => {
    expect(
      toCatalogManifest(catalog).components[0]!.images[0]!.livePreview,
    ).toBeUndefined();

    const linked = toCatalogManifest(catalog, {
      previewServer: { base: "https://preview.coo.ee/" },
    });
    const img = linked.components[0]!.images[0]!;
    // Targets the /p viewer route; preview id = the image path minus images/ and .png with the
    // subdir '/' flattened to '__' — exactly how `serve --catalogs` derives a route-safe catalog
    // preview id, so the link resolves to the live render.
    expect(img.livePreview).toBe(
      "https://preview.coo.ee/p/button-filled__ideal__default__light?session=compose-m3",
    );
  });
});

describe("toCatalogManifest themes", () => {
  const base: Catalog = {
    meta: { system: "wear-m3", title: "Wear M3" },
    components: [],
  };

  it("declares each theme's id, labels and token file", () => {
    const manifest = toCatalogManifest({
      ...base,
      themes: [
        {
          id: "com.example.BrandDarkThemeCatalog",
          name: "Brand Dark",
          group: "Brand",
          dark: true,
          tokens: { colors: { primary: "#4dd0e1" } },
        },
      ],
    });
    expect(manifest.themes).toEqual([
      {
        id: "com.example.BrandDarkThemeCatalog",
        name: "Brand Dark",
        group: "Brand",
        dark: true,
        tokensFile: "themes/com.example.branddarkthemecatalog.dtcg.json",
      },
    ]);
  });

  it("omits the array entirely when the system declares no themes", () => {
    expect(toCatalogManifest(base).themes).toBeUndefined();
    expect(toCatalogManifest({ ...base, themes: [] }).themes).toBeUndefined();
  });

  it("slugs a theme id into a filesystem-safe path", () => {
    // Ids are provider FQNs, but nothing stops a producer from an id with
    // separators in it — every one becomes a dash, so the result is a single
    // file name under themes/ that can never escape the directory.
    expect(themeTokensPath("a/../b Theme")).toBe("themes/a-..-b-theme.dtcg.json");
    expect(themeTokensPath("a/../b Theme")).not.toContain("/../");
  });
});

describe("livePreviewUrl", () => {
  it("targets the /p viewer route with the base normalized and the path flattened", () => {
    expect(
      livePreviewUrl(
        "https://preview.coo.ee///",
        "compose-m3",
        "images/fab/ideal__default__dark.png",
      ),
    ).toBe(
      "https://preview.coo.ee/p/fab__ideal__default__dark?session=compose-m3",
    );
  });
});
