import type { CatalogManifest } from "@design-parity/catalog-export";
import { validateDesignMap } from "@design-parity/core";
import type { DesignTokens } from "@design-parity/core";
import { describe, expect, it } from "vitest";

import { buildImportPlan } from "../src/plan.js";
import { applyImport, type FetchedImage } from "../src/scene.js";
import { createFakeFigma, descendants, type FakeNode } from "./fakeFigma.js";

const manifest: CatalogManifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    {
      componentId: "Button/Filled",
      group: "Buttons",
      images: [
        { variant: "ideal", path: "a-light", state: "default", theme: "light", width: 200, height: 72 },
        { variant: "ideal", path: "a-dark", state: "default", theme: "dark", width: 200, height: 72 },
        { variant: "layout", path: "a-layout", state: "default", theme: "light", width: 200, height: 72 },
      ],
      greenlines: [
        { kind: "a11y", severity: "error", message: "Touch target", bounds: { x: 4, y: 4, width: 40, height: 40 } },
      ],
      redlines: [
        { role: "Row", bounds: { x: 4, y: 4, width: 192, height: 64 }, padding: { top: 8, end: 8, bottom: 8, start: 8 }, cornerRadius: 20 },
      ],
    },
    {
      componentId: "Switch/On",
      group: "Controls",
      images: [
        { variant: "ideal", path: "b-on", state: "on", theme: "light", width: 120, height: 60 },
        { variant: "layout", path: "b-layout", state: "on", theme: "light", width: 120, height: 60 },
      ],
      greenlines: [
        { kind: "contrast", severity: "warn", message: "Track contrast", bounds: { x: 2, y: 2, width: 116, height: 32 } },
      ],
      redlines: [{ role: "Track", bounds: { x: 2, y: 2, width: 116, height: 32 }, cornerRadius: 16 }],
    },
  ],
};

const tokens: DesignTokens = {
  colors: { primary: "#6750A4", "surface.light": "#FFFBFE", "surface.dark": "#1C1B1F" },
  radius: { medium: 12 },
};

function bytesFor(paths: string[]): FetchedImage[] {
  return paths.map((path) => ({ path, bytes: new Uint8Array([1, 2, 3]) }));
}

describe("applyImport — ideal variant", () => {
  it("builds the page, tree, image fills, greenlines, variables, and design-map", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC123" });
    const result = await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]));

    // Summary + page.
    expect(result.summary).toBe(
      "Imported 3 renders across 2 groups, 2 a11y greenlines, 3 variables.",
    );
    expect(fake.figma.currentPage.name).toBe("Compose Material 3 — Catalog");
    expect(fake.state.fontsLoaded).toEqual([
      { family: "Inter", style: "Regular" },
      { family: "Inter", style: "Semi Bold" },
    ]);
    expect(fake.state.scrolledInto).toHaveLength(1);

    // Tree: root frame → title text + one section per group.
    const root = fake.root();
    expect(root.name).toBe("Compose Material 3");
    expect(root.layoutMode).toBe("VERTICAL");
    expect(root.children[0]!.kind).toBe("text");
    expect(root.children[0]!.characters).toBe("Compose Material 3");
    const sections = root.children.filter((c) => c.kind === "frame");
    expect(sections.map((s) => s.name)).toEqual(["Buttons", "Controls"]);

    // Image cells: one frame per placed render, each with an IMAGE fill.
    const imageCells = descendants(root, (n) => hasImageFill(n));
    expect(imageCells).toHaveLength(3);
    expect(fake.state.images).toHaveLength(3);

    // Greenlines: a rect stroked in the finding's severity colour (2px).
    const greenRects = descendants(root, (n) => n.kind === "rect" && n.strokeWeight === 2);
    expect(greenRects).toHaveLength(2);
    expect(greenRects[0]!.name).toContain("a11y (error)");
    expect(greenRects[0]!.strokes?.[0]).toMatchObject({
      type: "SOLID",
      color: { r: 0xcf / 255, g: 0x22 / 255, b: 0x2e / 255 },
    });
    // No redlines on the ideal variant.
    expect(descendants(root, (n) => n.dashPattern !== undefined)).toHaveLength(0);

    // Variable collection: light/dark modes + a COLOR variable carrying RGBA.
    expect(fake.state.collections).toHaveLength(1);
    const col = fake.state.collections[0]!;
    expect(col.name).toBe("Compose Material 3");
    expect(col.modes.map((m) => m.name).sort()).toEqual(["dark", "light"]);
    const primary = col.variables.find((v) => v.name === "color/primary")!;
    expect(primary.type).toBe("COLOR");
    expect(Object.values(primary.values)[0]).toMatchObject({ r: expect.any(Number), a: 1 });

    // Design-map: valid, one entry per placed component, refs carry the file key.
    expect(validateDesignMap(result.designMap).valid).toBe(true);
    expect(result.fileKeyKnown).toBe(true);
    expect(result.designMap.components.map((c) => c.code)).toEqual([
      "Button#Filled",
      "Switch#On",
    ]);
    expect(result.designMap.components[0]!.ref).toMatch(/^figma:ABC123\/\d+:\d+$/);
  });
});

describe("applyImport — layout variant", () => {
  it("draws dashed redlines with spec tags and no greenlines", async () => {
    const plan = buildImportPlan(manifest, {
      baseUrl: "https://x",
      themeTokens: tokens,
      variant: "layout",
    });
    const fake = createFakeFigma({ fileKey: "K" });
    const result = await applyImport(fake.figma, plan, bytesFor(["a-layout", "b-layout"]));

    expect(result.summary).toBe(
      "Imported 2 renders across 2 groups, 2 layout redlines, 3 variables.",
    );
    const root = fake.root();
    const redRects = descendants(root, (n) => n.kind === "rect" && n.dashPattern !== undefined);
    expect(redRects).toHaveLength(2);
    expect(redRects[0]!.strokeWeight).toBe(1);
    expect(redRects[0]!.cornerRadius).toBe(20);
    // Spec caption text.
    const tags = descendants(root, (n) => n.kind === "text" && n.characters === "Row · pad 8/8/8/8 · r 20");
    expect(tags).toHaveLength(1);
    // Greenlines are ideal-only.
    expect(descendants(root, (n) => n.kind === "rect" && n.strokeWeight === 2)).toHaveLength(0);
  });
});

describe("applyImport — edge cases", () => {
  it("skips components whose bytes are missing and omits them from the design-map", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    // Only Button/Filled's bytes; Switch/On has none.
    const result = await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark"]));

    expect(result.summary).toMatch(/^Imported 2 renders /);
    expect(fake.state.images).toHaveLength(2);
    expect(result.designMap.components.map((c) => c.code)).toEqual(["Button#Filled"]);
  });

  it("flags an unsaved file (null fileKey) with the FILE_KEY placeholder", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma(); // no fileKey
    const result = await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]));

    expect(result.fileKeyKnown).toBe(false);
    expect(result.designMap.components[0]!.ref).toMatch(/^figma:FILE_KEY\//);
  });
});

function hasImageFill(n: FakeNode): boolean {
  return (n.fills ?? []).some((f) => f.type === "IMAGE");
}
