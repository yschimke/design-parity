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

const catalogRoots = (fake: ReturnType<typeof createFakeFigma>): FakeNode[] =>
  fake.state.nodes.filter(
    (n) => n.kind === "frame" && n.getSharedPluginData("designParity", "role") === "catalog-root",
  );

describe("applyImport — per-screen pages (code-led)", () => {
  const screenManifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    screens: [{ id: "Screen/Home", title: "Home", related: ["Dialog/Confirm"] }],
    components: [
      { componentId: "Screen/Home", group: "Screens", images: [{ variant: "ideal", path: "home", state: "default", theme: "light", width: 100, height: 200 }], greenlines: [], redlines: [] },
      { componentId: "Dialog/Confirm", group: "Dialogs", images: [{ variant: "ideal", path: "dialog", state: "default", theme: "light", width: 100, height: 80 }], greenlines: [], redlines: [] },
      { componentId: "Widget/Clock", group: "Widgets", images: [{ variant: "ideal", path: "clock", state: "default", theme: "light", width: 100, height: 100 }], greenlines: [], redlines: [] },
    ],
  };

  const cardIds = (root: FakeNode): string[] =>
    descendants(root, (n) => n.getSharedPluginData("designParity", "role") === "card")
      .map((n) => n.getSharedPluginData("designParity", "componentId"))
      .sort();
  const rootForScope = (fake: ReturnType<typeof createFakeFigma>, scope: string): FakeNode =>
    catalogRoots(fake).find((r) => r.getSharedPluginData("designParity", "scope") === scope)!;

  it("lays out one page per screen plus a catalog page for the remainder", async () => {
    const plan = buildImportPlan(screenManifest, { baseUrl: "https://x" });
    expect(plan.screens).toHaveLength(1);
    const fake = createFakeFigma({ fileKey: "ABC" });
    const result = await applyImport(fake.figma, plan, bytesFor(["home", "dialog", "clock"]));

    expect(result.reconciled).toBe(false);
    expect(result.summary).toContain("across 2 pages");

    expect(fake.state.nodes.filter((n) => n.kind === "page").map((p) => p.name).sort()).toEqual([
      "Components",
      "Home",
    ]);
    expect(catalogRoots(fake).map((r) => r.getSharedPluginData("designParity", "scope")).sort()).toEqual([
      "components",
      "screen:Screen/Home",
    ]);

    // The screen page carries its main + related; the remainder is the Components library.
    expect(cardIds(rootForScope(fake, "screen:Screen/Home"))).toEqual(["Dialog/Confirm", "Screen/Home"]);
    expect(cardIds(rootForScope(fake, "components"))).toEqual(["Widget/Clock"]);

    expect(result.designMap.components.map((c) => c.code).sort()).toEqual([
      "Dialog#Confirm",
      "Screen#Home",
      "Widget#Clock",
    ]);
    expect(validateDesignMap(result.designMap).valid).toBe(true);
  });

  it("reconciles each screen page in place on re-import (no new pages, ids kept)", async () => {
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, buildImportPlan(screenManifest, { baseUrl: "https://x" }), bytesFor(["home", "dialog", "clock"]));
    const homeId = catalogRoots(fake).flatMap((r) => descendants(r, isCard("Screen/Home")))[0]!.id;

    const result = await applyImport(fake.figma, buildImportPlan(screenManifest, { baseUrl: "https://x" }), bytesFor(["home", "dialog", "clock"]));

    expect(result.reconciled).toBe(true);
    expect(result.summary).toContain("Reconciled");
    // No second set of pages.
    expect(fake.state.nodes.filter((n) => n.kind === "page")).toHaveLength(2);
    // The Screen/Home card kept its identity.
    const homeAfter = catalogRoots(fake).flatMap((r) => descendants(r, isCard("Screen/Home")))[0]!;
    expect(homeAfter.id).toBe(homeId);
  });
});

describe("applyImport — Themes/Tokens page (code-led)", () => {
  const tokensManifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    components: [
      { componentId: "Theme/Light", group: "Themes", images: [{ variant: "ideal", path: "tl", state: "default", theme: "light", width: 300, height: 400 }], greenlines: [], redlines: [] },
      { componentId: "Theme/Dark", group: "Themes", images: [{ variant: "ideal", path: "td", state: "default", theme: "dark", width: 300, height: 400 }], greenlines: [], redlines: [] },
      { componentId: "Button/Filled", group: "Buttons", images: [{ variant: "ideal", path: "bf", state: "default", theme: "light", width: 200, height: 72 }], greenlines: [], redlines: [] },
    ],
  };

  it("routes theme foundations to a Themes / Tokens page and still creates the variable collection", async () => {
    const plan = buildImportPlan(tokensManifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    const result = await applyImport(fake.figma, plan, bytesFor(["tl", "td", "bf"]));

    expect(result.summary).toContain("across 2 pages");
    expect(fake.state.nodes.filter((n) => n.kind === "page").map((p) => p.name).sort()).toEqual([
      "Components",
      "Themes / Tokens",
    ]);

    const ids = (scope: string): string[] =>
      descendants(
        catalogRoots(fake).find((r) => r.getSharedPluginData("designParity", "scope") === scope)!,
        (n) => n.getSharedPluginData("designParity", "role") === "card",
      )
        .map((n) => n.getSharedPluginData("designParity", "componentId"))
        .sort();

    expect(ids("tokens")).toEqual(["Theme/Dark", "Theme/Light"]);
    expect(ids("components")).toEqual(["Button/Filled"]);
    // The token variable collection (light/dark modes) is still created once.
    expect(fake.state.collections).toHaveLength(1);
    expect(fake.state.collections[0]!.modes.map((m) => m.name).sort()).toEqual(["dark", "light"]);
  });
});

describe("applyImport — Components page (native component sets)", () => {
  // Themes present ⇒ structured layout; Button/Filled has two theme renders that
  // should become two variants of one component set.
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    components: [
      { componentId: "Theme/Light", group: "Themes", images: [{ variant: "ideal", path: "tl", state: "default", theme: "light", width: 300, height: 400 }], greenlines: [], redlines: [] },
      { componentId: "Button/Filled", group: "Buttons", images: [
        { variant: "ideal", path: "bl", state: "default", theme: "light", width: 200, height: 72 },
        { variant: "ideal", path: "bd", state: "default", theme: "dark", width: 200, height: 72 },
      ], greenlines: [], redlines: [] },
    ],
  };

  const buttonSet = (fake: ReturnType<typeof createFakeFigma>): FakeNode =>
    fake.state.nodes.find(
      (n) => n.kind === "component-set" && n.getSharedPluginData("designParity", "componentId") === "Button/Filled",
    )!;

  it("builds each library component as a native set with variant-named components", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["tl", "bl", "bd"]));

    const set = buttonSet(fake);
    expect(set.getSharedPluginData("designParity", "role")).toBe("card");
    expect(set.name).toBe("Button/Filled");
    // Two COMPONENT variants, each named with its variant properties.
    const variants = set.children.filter((c) => c.kind === "component");
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.name).sort()).toEqual([
      "state=default, theme=dark",
      "state=default, theme=light",
    ]);
    // Each variant is an image cell (role=image) with an IMAGE fill.
    expect(variants.every((v) => v.getSharedPluginData("designParity", "role") === "image")).toBe(true);
    expect(variants.every((v) => (v.fills ?? []).some((f) => f.type === "IMAGE"))).toBe(true);
  });

  it("reconciles a component set in place on re-import (set id kept, fills swapped)", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["tl", "bl", "bd"]));
    const setId = buttonSet(fake).id;
    const imagesBefore = fake.state.images.length;

    const result = await applyImport(fake.figma, plan, bytesFor(["tl", "bl", "bd"]));

    expect(result.reconciled).toBe(true);
    expect(buttonSet(fake).id).toBe(setId); // same set node
    expect(buttonSet(fake).children.filter((c) => c.kind === "component")).toHaveLength(2); // no dupes
    expect(fake.state.images.length).toBeGreaterThan(imagesBefore); // fills re-created from new bytes
  });
});

describe("applyImport — vector wireframe lane (screen pages)", () => {
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    screens: [{ id: "Screen/Home", title: "Home" }],
    components: [
      {
        componentId: "Screen/Home",
        group: "Screens",
        images: [{ variant: "ideal", path: "home", state: "default", theme: "light", width: 100, height: 200 }],
        greenlines: [],
        redlines: [],
        wireframe: "wireframes/screen-home.svg",
      },
    ],
  };
  // The UI fetches the wireframe SVG text into the plan; simulate that here.
  const planWithSvg = (): ReturnType<typeof buildImportPlan> => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    expect(plan.groups[0]!.components[0]!.wireframeUrl).toBe("https://x/wireframes/screen-home.svg");
    plan.groups[0]!.components[0]!.wireframeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    return plan;
  };
  const wireframeNodes = (fake: ReturnType<typeof createFakeFigma>): FakeNode[] =>
    fake.state.nodes.filter((n) => n.getSharedPluginData("designParity", "role") === "wireframe");

  it("places the wireframe as a vector node (createNodeFromSvg), not a raster cell", async () => {
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, planWithSvg(), bytesFor(["home"]));

    const wf = wireframeNodes(fake);
    expect(wf).toHaveLength(1);
    expect(wf[0]!.fromSvg).toContain("<svg");
    expect(wf[0]!.getSharedPluginData("designParity", "componentId")).toBe("Screen/Home");
    // It lives inside the Screen/Home card, alongside the code render.
    expect(wf[0]!.parent!.getSharedPluginData("designParity", "role")).toBe("card");
  });

  it("re-places the vector wireframe on re-import — still exactly one", async () => {
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, planWithSvg(), bytesFor(["home"]));
    const firstId = wireframeNodes(fake)[0]!.id;

    const result = await applyImport(fake.figma, planWithSvg(), bytesFor(["home"]));
    expect(result.reconciled).toBe(true);
    const wf = wireframeNodes(fake);
    expect(wf).toHaveLength(1); // old removed, fresh placed
    expect(wf[0]!.id).not.toBe(firstId); // re-placed, not the same node
  });
});

describe("applyImport — wireframe comparison lane (screen pages)", () => {
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    screens: [{ id: "Screen/Home", title: "Home" }],
    components: [
      { componentId: "Screen/Home", group: "Screens", images: [
        { variant: "ideal", path: "home", state: "default", theme: "light", width: 100, height: 200 },
        { variant: "layout", path: "home-wire", state: "default", theme: "light", width: 100, height: 200 },
      ], greenlines: [], redlines: [{ role: "Column", bounds: { x: 4, y: 4, width: 92, height: 192 }, cornerRadius: 8 }] },
    ],
  };

  const screenCard = (fake: ReturnType<typeof createFakeFigma>): FakeNode =>
    descendants(
      catalogRoots(fake).find((r) => r.getSharedPluginData("designParity", "scope") === "screen:Screen/Home")!,
      isCard("Screen/Home"),
    )[0]!;

  it("carries the layout wireframe and its redlines as a compare lane in the plan", () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const home = plan.groups[0]!.components[0]!;
    expect(home.images.map((i) => i.path)).toEqual(["home"]); // ideal only
    expect(home.compare?.map((i) => i.path)).toEqual(["home-wire"]); // layout wireframe
    expect(home.compareRedlines).toHaveLength(1); // the wireframe's spacing spec
  });

  it("draws the spacing redlines on the wireframe lane, not the code lane", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["home", "home-wire"]));

    const card = screenCard(fake);
    const dashed = (predName: (n: string) => boolean): FakeNode[] =>
      descendants(card, (n) => n.dashPattern !== undefined && predName(n.parent?.name ?? ""));
    // The wireframe cell carries the dashed redline; the code (ideal) cell does not.
    expect(dashed((name) => name.includes("wireframe")).length).toBeGreaterThanOrEqual(1);
    expect(dashed((name) => !name.includes("wireframe")).length).toBe(0);
  });

  it("places the code render and the wireframe side by side on the screen card", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["home", "home-wire"]));

    const card = descendants(
      catalogRoots(fake).find((r) => r.getSharedPluginData("designParity", "scope") === "screen:Screen/Home")!,
      isCard("Screen/Home"),
    )[0]!;
    const cells = descendants(card, (n) => (n.fills ?? []).some((f) => f.type === "IMAGE"));
    // Two lanes: the ideal render (code) and the wireframe.
    expect(cells).toHaveLength(2);
    expect(cells.some((c) => c.name.includes("wireframe"))).toBe(true);
    expect(cells.every((c) => c.getSharedPluginData("designParity", "role") === "image")).toBe(true);
  });

  it("refreshes both lanes in place on re-import", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["home", "home-wire"]));
    const before = fake.state.images.length;

    const result = await applyImport(fake.figma, plan, bytesFor(["home", "home-wire"]));
    expect(result.reconciled).toBe(true);
    // Both the code cell and the wireframe cell re-created their fills (2 images).
    expect(fake.state.images.length).toBe(before + 2);
  });
});

describe("applyImport — Figma spec header (screen pages)", () => {
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    screens: [{ id: "Screen/Home", title: "Home", related: ["Dialog/Confirm"] }],
    components: [
      { componentId: "Screen/Home", group: "Screens", images: [{ variant: "ideal", path: "home", state: "default", theme: "light", width: 100, height: 200 }], greenlines: [], redlines: [] },
      { componentId: "Dialog/Confirm", group: "Dialogs", images: [{ variant: "ideal", path: "dialog", state: "default", theme: "light", width: 100, height: 80 }], greenlines: [], redlines: [] },
    ],
  };

  const specFrame = (fake: ReturnType<typeof createFakeFigma>): FakeNode | undefined =>
    fake.state.nodes.find(
      (n) => n.kind === "frame" && n.getSharedPluginData("designParity", "role") === "spec" && n.getSharedPluginData("designParity", "componentId") === "Screen/Home",
    );
  const specSeedHash = (frame: FakeNode): string =>
    (descendants(frame, (n) => (n.fills ?? []).some((f) => f.type === "IMAGE"))[0]!.fills!.find((f) => f.type === "IMAGE")! as { imageHash: string }).imageHash;

  it("seeds a designer-owned Figma spec frame from the main screen's render", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["home", "dialog"]));

    const spec = specFrame(fake);
    expect(spec).toBeDefined();
    expect(spec!.name).toBe("Figma spec — Screen/Home");
    // It carries a seeded render, but is NOT a card/image node (so reconcile skips it).
    expect(descendants(spec!, (n) => (n.fills ?? []).some((f) => f.type === "IMAGE"))).toHaveLength(1);
    expect(descendants(spec!, (n) => n.getSharedPluginData("designParity", "role") === "image")).toHaveLength(0);
  });

  it("never re-seeds or refreshes the spec on a re-import (designer owns it)", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["home", "dialog"]));
    const before = specFrame(fake)!;
    const beforeId = before.id;
    const beforeHash = specSeedHash(before);

    const result = await applyImport(fake.figma, plan, bytesFor(["home", "dialog"]));

    expect(result.reconciled).toBe(true);
    // Exactly one spec frame still, same node, same seeded fill (untouched).
    const specs = fake.state.nodes.filter((n) => n.kind === "frame" && n.getSharedPluginData("designParity", "role") === "spec");
    expect(specs).toHaveLength(1);
    expect(specs[0]!.id).toBe(beforeId);
    expect(specSeedHash(specs[0]!)).toBe(beforeHash);
  });
});

describe("applyImport — variant props axis (label vs icon+label)", () => {
  // Themes present ⇒ structured layout so Button/Filled lands on the Components
  // page as a set. It carries a content axis beyond state/theme.
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    components: [
      { componentId: "Theme/Light", group: "Themes", images: [{ variant: "ideal", path: "tl", state: "default", theme: "light", width: 300, height: 400 }], greenlines: [], redlines: [] },
      { componentId: "Button/Filled", group: "Buttons", images: [
        { variant: "ideal", path: "bl", state: "default", theme: "light", width: 200, height: 72 },
        { variant: "ideal", path: "bi", state: "default", theme: "light", props: { content: "icon+label" }, width: 220, height: 72 },
      ], greenlines: [], redlines: [] },
    ],
  };

  it("turns a content prop into a component-set variant property", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x" });
    const fake = createFakeFigma({ fileKey: "ABC" });
    await applyImport(fake.figma, plan, bytesFor(["tl", "bl", "bi"]));

    const set = fake.state.nodes.find(
      (n) => n.kind === "component-set" && n.getSharedPluginData("designParity", "componentId") === "Button/Filled",
    )!;
    const names = set.children.filter((c) => c.kind === "component").map((c) => c.name).sort();
    expect(names).toEqual([
      "state=default, theme=light",
      "state=default, theme=light, content=icon+label",
    ]);
  });
});

describe("applyImport — design-led mode gate", () => {
  it("dry-runs without writing anything until confirmed", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    const result = await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]), {
      direction: "design-led",
    });

    expect(result.pendingConfirmation).toBe(true);
    expect(result.reconciled).toBe(false);
    expect(result.summary).toContain("confirm to import 3 renders across 2 groups");
    expect(result.summary).toContain("Code renders (reference)");
    // Read-only: not a single node was created.
    expect(fake.state.nodes).toHaveLength(0);
    expect(fake.state.images).toHaveLength(0);
  });

  it("writes to the reference page when confirmed, stamped design-led", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });
    const result = await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]), {
      direction: "design-led",
      confirmDesignLed: true,
    });

    expect(result.pendingConfirmation).toBeFalsy();
    expect(fake.figma.currentPage.name).toBe("Code renders (reference)");
    expect(fake.root().getSharedPluginData("designParity", "mode")).toBe("design-led");
    expect(fake.state.images).toHaveLength(3);
  });

  it("keeps the design-led reference board separate from a code-led catalog", async () => {
    const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const fake = createFakeFigma({ fileKey: "ABC" });

    // Code-led catalog first (default direction).
    await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]));
    const codeLedRoot = catalogRoots(fake)[0]!;
    const codeLedButtonId = descendants(codeLedRoot, isCard("Button/Filled"))[0]!.id;

    // A confirmed design-led import must NOT reconcile the code-led board — it
    // creates its own reference page.
    await applyImport(fake.figma, plan, bytesFor(["a-light", "a-dark", "b-on"]), {
      direction: "design-led",
      confirmDesignLed: true,
    });

    const roots = catalogRoots(fake);
    expect(roots.map((r) => r.getSharedPluginData("designParity", "mode")).sort()).toEqual([
      "code-led",
      "design-led",
    ]);
    expect(fake.state.nodes.filter((n) => n.kind === "page")).toHaveLength(2);
    // The code-led card kept its identity — untouched by the design-led import.
    expect(descendants(codeLedRoot, isCard("Button/Filled"))[0]!.id).toBe(codeLedButtonId);
  });
});

const isCard = (componentId: string) => (n: FakeNode): boolean =>
  n.getSharedPluginData("designParity", "role") === "card" &&
  n.getSharedPluginData("designParity", "componentId") === componentId;

describe("applyImport — reconcile (re-import)", () => {
  // A second catalog: Button/Filled's renders change, Chip/Assist is new (same
  // group), and Switch/On is gone.
  const manifest2: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: "compose-m3",
    title: "Compose Material 3",
    components: [
      {
        componentId: "Button/Filled",
        group: "Buttons",
        images: [
          { variant: "ideal", path: "a-light-v2", state: "default", theme: "light", width: 200, height: 72 },
          { variant: "ideal", path: "a-dark-v2", state: "default", theme: "dark", width: 200, height: 72 },
        ],
        greenlines: [],
        redlines: [],
      },
      {
        componentId: "Chip/Assist",
        group: "Buttons",
        images: [
          { variant: "ideal", path: "chip", state: "default", theme: "light", width: 120, height: 40 },
        ],
        greenlines: [],
        redlines: [],
      },
    ],
  };

  it("updates matched cards in place, adds newcomers, and tags removed cards stale", async () => {
    const fake = createFakeFigma({ fileKey: "ABC123" });

    // First import (fresh).
    const plan1 = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens: tokens });
    const first = await applyImport(fake.figma, plan1, bytesFor(["a-light", "a-dark", "b-on"]));
    expect(first.reconciled).toBe(false);

    const buttonBefore = descendants(fake.root(), isCard("Button/Filled"))[0]!;
    const buttonId = buttonBefore.id;
    const pagesAfterFirst = fake.state.nodes.filter((n) => n.kind === "page").length;
    expect(pagesAfterFirst).toBe(1);

    // Second import (reconcile) onto the same file.
    const plan2 = buildImportPlan(manifest2, { baseUrl: "https://x", themeTokens: tokens });
    const second = await applyImport(fake.figma, plan2, bytesFor(["a-light-v2", "a-dark-v2", "chip"]));

    expect(second.reconciled).toBe(true);
    expect(second.summary).toBe("Reconciled Compose Material 3: 1 updated, 1 added, 1 tagged stale.");

    // No second page — reconcile reuses the existing board.
    expect(fake.state.nodes.filter((n) => n.kind === "page").length).toBe(1);

    // Button/Filled kept its identity: same node id, fills swapped to new bytes.
    const buttonAfter = descendants(fake.root(), isCard("Button/Filled"))[0]!;
    expect(buttonAfter.id).toBe(buttonId);
    const buttonCells = descendants(buttonAfter, (n) => hasImageFill(n));
    expect(buttonCells).toHaveLength(2);
    // Fills point at images created during the second import (img3+).
    for (const cell of buttonCells) {
      const hash = cell.fills!.find((f) => f.type === "IMAGE")!;
      expect(hash.type === "IMAGE" && Number(hash.imageHash.replace("img", ""))).toBeGreaterThanOrEqual(3);
    }

    // Chip/Assist added into the existing Buttons section.
    const chip = descendants(fake.root(), isCard("Chip/Assist"))[0];
    expect(chip).toBeDefined();
    expect(chip!.parent!.name).toBe("Buttons");

    // Switch/On is gone from the catalog → tagged stale in place, not deleted.
    const switchCard = descendants(fake.root(), isCard("Switch/On"))[0]!;
    expect(switchCard.getSharedPluginData("designParity", "state")).toBe("stale");
    expect(switchCard.name.startsWith("(stale) ")).toBe(true);

    // Design-map reflects the current catalog (updated + added), not the stale one.
    expect(second.designMap.components.map((c) => c.code).sort()).toEqual([
      "Button#Filled",
      "Chip#Assist",
    ]);
    expect(validateDesignMap(second.designMap).valid).toBe(true);
  });
});
