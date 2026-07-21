import { describe, expect, it } from "vitest";

import type { CatalogManifest, CatalogManifestImage } from "@design-parity/catalog-export";

import {
  componentSetCells,
  groupComponents,
  indexCatalog,
  selectCatalogDesignVector,
  selectCatalogImage,
  selectCatalogWireframe,
} from "../src/catalogPick.js";

function image(over: Partial<CatalogManifestImage>): CatalogManifestImage {
  return {
    variant: "ideal",
    path: "images/x.png",
    state: "default",
    width: 200,
    height: 72,
    ...over,
  };
}

/** A catalog with a rich Button (variant + theme + size + a content prop) and a
 *  single-render Switch, plus one layout-only wireframe. */
const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Filled",
      group: "Buttons",
      caption: "The primary action.",
      wireframe: "wireframes/button-filled.svg",
      greenlines: [],
      redlines: [],
      images: [
        image({ path: "b/default-light-compact.png", state: "default", theme: "light", size: "compact" }),
        image({ path: "b/default-dark-compact.png", state: "default", theme: "dark", size: "compact" }),
        image({ path: "b/default-light-medium.png", state: "default", theme: "light", size: "medium" }),
        image({ path: "b/pressed-light-compact.png", state: "pressed", theme: "light", size: "compact" }),
        image({
          path: "b/iconlabel-light-compact.png",
          state: "default",
          theme: "light",
          size: "compact",
          props: { content: "icon+label" },
        }),
        // A layout wireframe render — never offered by the ideal-only picker.
        image({ variant: "layout", path: "b/layout.png", state: "default", theme: "light" }),
      ],
    },
    {
      componentId: "Switch/On",
      group: "Selection",
      greenlines: [],
      redlines: [],
      images: [image({ path: "s/on.png", state: "on", theme: "light" })],
    },
  ],
};

describe("indexCatalog", () => {
  it("exposes the state axis as the variant, and theme/size/props as dimensions", () => {
    const index = indexCatalog(manifest);
    expect(index.system).toBe("compose-m3");

    const button = index.components.find((c) => c.componentId === "Button/Filled")!;
    expect(button.group).toBe("Buttons");
    expect(button.caption).toBe("The primary action.");
    expect(button.hasWireframe).toBe(true);

    // Variant = the `state` axis, in first-seen order.
    expect(button.variant).toEqual({ key: "state", label: "Variant", values: ["default", "pressed"] });

    // Dimensions: theme, size, then the extra `content` prop axis, labelled.
    expect(button.dimensions).toEqual([
      { key: "theme", label: "Theme", values: ["light", "dark"] },
      { key: "size", label: "Size", values: ["compact", "medium"] },
      { key: "prop:content", label: "Content", values: ["icon+label"] },
    ]);
  });

  it("labels and captions the i18n dimensions (locale / direction / font-scale, #220)", () => {
    // A catalog rendered across the i18n axes — they arrive as `props`, so the
    // picker surfaces them data-driven; the plugin only makes the known ones
    // read nicely (Font scale, not FontScale) and captions what each checks.
    const i18nManifest: CatalogManifest = {
      schema: "design-parity-catalog/v1",
      system: "compose-m3",
      title: "Compose Material 3",
      components: [
        {
          componentId: "Button/Filled",
          greenlines: [],
          redlines: [],
          images: [
            image({ path: "a.png", props: { locale: "en", direction: "ltr", fontScale: "1.0" } }),
            image({ path: "b.png", props: { locale: "ar", direction: "rtl", fontScale: "1.0" } }),
            image({ path: "c.png", props: { locale: "en-XA", direction: "ltr", fontScale: "2.0" } }),
          ],
        },
      ],
    };

    const button = indexCatalog(i18nManifest).components[0]!;
    expect(button.dimensions).toEqual([
      {
        key: "prop:locale",
        label: "Locale",
        values: ["en", "ar", "en-XA"],
        caption: "checks text expansion / truncation",
      },
      {
        key: "prop:direction",
        label: "Direction",
        values: ["ltr", "rtl"],
        caption: "checks RTL mirroring",
      },
      {
        key: "prop:fontScale",
        label: "Font scale",
        values: ["1.0", "2.0"],
        caption: "checks dynamic type",
      },
    ]);
  });

  it("leaves a non-i18n prop axis uncaptioned with the generic label", () => {
    const button = indexCatalog(manifest).components.find(
      (c) => c.componentId === "Button/Filled",
    )!;
    const content = button.dimensions.find((d) => d.key === "prop:content")!;
    expect(content.label).toBe("Content");
    expect(content.caption).toBeUndefined();
  });

  it("omits an axis with a single value and a missing variant/wireframe", () => {
    const index = indexCatalog(manifest);
    const sw = index.components.find((c) => c.componentId === "Switch/On")!;
    // One state, one theme, no size/props ⇒ no variant, no dimensions.
    expect(sw.variant).toBeUndefined();
    expect(sw.dimensions).toEqual([]);
    expect(sw.hasWireframe).toBe(false);
  });

  it("drops components with no ideal render", () => {
    const layoutOnly: CatalogManifest = {
      ...manifest,
      components: [
        {
          componentId: "Ghost",
          greenlines: [],
          redlines: [],
          images: [image({ variant: "layout", path: "g/layout.png" })],
        },
      ],
    };
    expect(indexCatalog(layoutOnly).components).toEqual([]);
  });
});

describe("selectCatalogImage", () => {
  const base = "https://cdn.example/compose-m3";

  it("resolves the first image matching every specified axis", () => {
    const picked = selectCatalogImage(
      manifest,
      { componentId: "Button/Filled", variant: "default", dimensions: { theme: "dark", size: "compact" } },
      base,
    );
    expect(picked?.image.path).toBe("b/default-dark-compact.png");
    expect(picked?.url).toBe("https://cdn.example/compose-m3/b/default-dark-compact.png");
  });

  it("treats an omitted / blank axis as 'any' — first match wins", () => {
    const picked = selectCatalogImage(manifest, { componentId: "Button/Filled" }, base);
    expect(picked?.image.path).toBe("b/default-light-compact.png");

    const blank = selectCatalogImage(
      manifest,
      { componentId: "Button/Filled", variant: "", dimensions: { theme: "", size: "medium" } },
      base,
    );
    expect(blank?.image.path).toBe("b/default-light-medium.png");
  });

  it("matches a prop-axis dimension", () => {
    const picked = selectCatalogImage(
      manifest,
      { componentId: "Button/Filled", dimensions: { "prop:content": "icon+label" } },
      base,
    );
    expect(picked?.image.path).toBe("b/iconlabel-light-compact.png");
  });

  it("returns undefined for an unknown component or an impossible combination", () => {
    expect(selectCatalogImage(manifest, { componentId: "Nope" }, base)).toBeUndefined();
    expect(
      selectCatalogImage(
        manifest,
        { componentId: "Button/Filled", variant: "pressed", dimensions: { theme: "dark" } },
        base,
      ),
    ).toBeUndefined();
  });

  it("never selects a layout image (ideal-only)", () => {
    const picked = selectCatalogImage(manifest, { componentId: "Button/Filled" }, base);
    expect(picked?.image.variant).toBe("ideal");
  });
});

describe("groupComponents", () => {
  const index = indexCatalog(manifest);

  it("groups by group in first-seen order, no query", () => {
    const groups = groupComponents(index);
    expect(groups.map((g) => g.name)).toEqual(["Buttons", "Selection"]);
    expect(groups[0]!.components.map((c) => c.componentId)).toEqual(["Button/Filled"]);
    expect(groups[1]!.components.map((c) => c.componentId)).toEqual(["Switch/On"]);
  });

  it("filters by id, caption, or group (case-insensitive) and drops empty groups", () => {
    expect(groupComponents(index, "switch").map((g) => g.name)).toEqual(["Selection"]);
    // 'primary' only appears in Button/Filled's caption.
    expect(groupComponents(index, "PRIMARY").map((g) => g.components[0]!.componentId)).toEqual([
      "Button/Filled",
    ]);
    // Group-name match.
    expect(groupComponents(index, "selection")[0]!.components[0]!.componentId).toBe("Switch/On");
    // No match ⇒ no groups.
    expect(groupComponents(index, "zzz")).toEqual([]);
  });

  it("falls back to an Ungrouped bucket for components with no group", () => {
    const noGroup = indexCatalog({
      ...manifest,
      components: [{ componentId: "Loose", greenlines: [], redlines: [], images: [image({})] }],
    });
    expect(groupComponents(noGroup).map((g) => g.name)).toEqual(["Ungrouped"]);
  });
});

describe("componentSetCells", () => {
  const base = "https://cdn.example/compose-m3";

  it("returns one named cell per ideal render, ideal-only, with resolved URLs", () => {
    const cells = componentSetCells(manifest, "Button/Filled", base);
    // Five ideal images (the layout render is excluded).
    expect(cells).toHaveLength(5);
    expect(cells.every((c) => !c.path.includes("layout"))).toBe(true);
    expect(cells[0]).toEqual({
      path: "b/default-light-compact.png",
      url: "https://cdn.example/compose-m3/b/default-light-compact.png",
      name: "state=default, theme=light, size=compact",
      width: 200,
      height: 72,
    });
    // The prop-axis cell names its extra axis, sorted after state/theme/size.
    expect(cells.find((c) => c.path.includes("iconlabel"))!.name).toBe(
      "state=default, theme=light, size=compact, content=icon+label",
    );
  });

  it("names a single-axis component minimally and returns [] for unknown ids", () => {
    expect(componentSetCells(manifest, "Switch/On", base).map((c) => c.name)).toEqual([
      "state=on, theme=light",
    ]);
    expect(componentSetCells(manifest, "Nope", base)).toEqual([]);
  });
});

describe("selectCatalogWireframe", () => {
  it("resolves the wireframe URL when present, else undefined", () => {
    expect(selectCatalogWireframe(manifest, "Button/Filled", "https://cdn.example/compose-m3")).toBe(
      "https://cdn.example/compose-m3/wireframes/button-filled.svg",
    );
    expect(selectCatalogWireframe(manifest, "Switch/On", "https://cdn.example/compose-m3")).toBeUndefined();
    expect(selectCatalogWireframe(manifest, "Nope", "https://cdn.example/compose-m3")).toBeUndefined();
  });
});

describe("selectCatalogDesignVector", () => {
  const base = "https://cdn.example/compose-m3";

  it("reuses the wireframe's slug (wireframes/ → figma/) when a wireframe is present", () => {
    // Button/Filled has wireframe = wireframes/button-filled.svg.
    expect(selectCatalogDesignVector(manifest, "Button/Filled", base)).toBe(
      "https://cdn.example/compose-m3/figma/button-filled.svg",
    );
  });

  it("derives figma/<slug>.svg from the component id when there's no wireframe", () => {
    // Switch/On has no wireframe; slug lowercases and replaces the slash.
    expect(selectCatalogDesignVector(manifest, "Switch/On", base)).toBe(
      "https://cdn.example/compose-m3/figma/switch-on.svg",
    );
  });

  it("returns undefined only for an unknown component", () => {
    expect(selectCatalogDesignVector(manifest, "Nope", base)).toBeUndefined();
  });
});
