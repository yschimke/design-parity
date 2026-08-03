import { afterEach, describe, expect, it } from "vitest";

import {
  bindImportedTextStyles,
  bindImportedVariables,
  preflightSvgFonts,
  promoteNativeContainers,
  promoteNativeRoundedRects,
} from "../figma/nativeSvg.js";
import {
  appendRuntimeNodes as append,
  installFigmaRuntime as installRuntime,
  resetRuntimeIds,
  runtimeNode as node,
  sceneContract,
} from "./figmaRuntimeHarness.js";

const previousFigma = globalThis.figma;

afterEach(() => {
  resetRuntimeIds();
  globalThis.figma = previousFigma;
});

describe("Figma-runtime native SVG promotion", () => {
  it("promotes a padded list to a fixed-size vertical Auto Layout frame", () => {
    installRuntime();
    const root = node("FRAME");
    const before = node("TEXT", { name: "Before" });
    const group = node("GROUP", {
      name: "List",
      x: 40,
      y: 80,
      width: 200,
      height: 148,
      opacity: 0.8,
      blendMode: "MULTIPLY",
      effects: [{ type: "LAYER_BLUR" }],
    });
    const background = node("RECTANGLE", {
      name: "Surface",
      width: 200,
      height: 148,
      opacity: 0.5,
      fills: [{ type: "SOLID", color: "surface" }],
      strokes: [{ type: "SOLID", color: "outline" }],
      cornerRadius: 16,
      effects: [{ type: "DROP_SHADOW" }],
    });
    const first = node("TEXT", { name: "One", x: 16, y: 12, width: 168, height: 36 });
    const second = node("TEXT", { name: "Two", x: 16, y: 56, width: 168, height: 36 });
    const third = node("TEXT", { name: "Three", x: 16, y: 100, width: 168, height: 36 });
    const after = node("TEXT", { name: "After" });
    append(group, background, first, second, third);
    append(root, before, group, after);

    expect(promoteNativeContainers(root as unknown as SceneNode)).toBe(1);

    const frame = root.children[1]!;
    expect(root.children.map((child) => child.name)).toEqual(["Before", "List", "After"]);
    expect(frame.type).toBe("FRAME");
    expect(frame.children).toEqual([first, second, third]);
    expect(frame).toMatchObject({
      x: 40,
      y: 80,
      width: 200,
      height: 148,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "CENTER",
      itemSpacing: 8,
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      fills: background.fills,
      strokes: background.strokes,
      cornerRadius: 16,
      opacity: 0.4,
      blendMode: "MULTIPLY",
    });
    expect(sceneContract(frame)).toMatchInlineSnapshot(`
      {
        "autoLayout": {
          "align": [
            "MIN",
            "CENTER",
          ],
          "gap": 8,
          "mode": "VERTICAL",
          "padding": [
            12,
            16,
            12,
            16,
          ],
          "sizing": [
            "FIXED",
            "FIXED",
          ],
        },
        "children": [
          {
            "children": [],
            "name": "One",
            "position": {
              "x": 16,
              "y": 12,
            },
            "size": {
              "height": 36,
              "width": 168,
            },
            "type": "TEXT",
          },
          {
            "children": [],
            "name": "Two",
            "position": {
              "x": 16,
              "y": 56,
            },
            "size": {
              "height": 36,
              "width": 168,
            },
            "type": "TEXT",
          },
          {
            "children": [],
            "name": "Three",
            "position": {
              "x": 16,
              "y": 100,
            },
            "size": {
              "height": 36,
              "width": 168,
            },
            "type": "TEXT",
          },
        ],
        "cornerRadius": 16,
        "effects": [
          {
            "type": "LAYER_BLUR",
          },
          {
            "type": "DROP_SHADOW",
          },
        ],
        "fills": [
          {
            "color": "surface",
            "type": "SOLID",
          },
        ],
        "name": "List",
        "opacity": 0.4,
        "position": {
          "x": 40,
          "y": 80,
        },
        "size": {
          "height": 148,
          "width": 200,
        },
        "strokes": [
          {
            "color": "outline",
            "type": "SOLID",
          },
        ],
        "type": "FRAME",
      }
    `);
    expect(group.removed).toBe(true);
    expect(background.removed).toBe(true);
  });

  it("keeps overlapping artwork out of Auto Layout while retaining a native frame", () => {
    installRuntime();
    const root = node("FRAME");
    const group = node("GROUP", { name: "Artwork", width: 48, height: 48 });
    append(group,
      node("RECTANGLE", { width: 48, height: 48 }),
      node("RECTANGLE", { x: 8, y: 8, width: 32, height: 32 }),
      node("VECTOR", { x: 16, y: 16, width: 16, height: 16 }),
    );
    append(root, group);

    expect(promoteNativeContainers(root as unknown as SceneNode)).toBe(1);
    expect(root.children[0]).toMatchObject({ type: "FRAME", name: "Artwork", layoutMode: "NONE" });
  });

  it("replaces the Compose pill vector in place with an editable rectangle", () => {
    installRuntime();
    const root = node("FRAME");
    const before = node("TEXT", { name: "Before" });
    const vector = node("VECTOR", {
      x: 10,
      y: 20,
      width: 216,
      height: 105,
      rotation: 4,
      opacity: 0.7,
      fills: [{ type: "SOLID", color: "#6750A4" }],
      strokes: [{ type: "SOLID", color: "#000000" }],
      effects: [{ type: "DROP_SHADOW" }],
    });
    const after = node("TEXT", { name: "After" });
    append(root, before, vector, after);
    const svg = '<path d="M94.5,53 H205.5 A52.5,52.5 0 0 1 258,105.5 V105.5 A52.5,52.5 0 0 1 205.5,158 H94.5 A52.5,52.5 0 0 1 42,105.5 V105.5 A52.5,52.5 0 0 1 94.5,53 Z" fill="#6750A4"/>';

    expect(promoteNativeRoundedRects(root as unknown as SceneNode, svg)).toBe(1);

    const rectangle = root.children[1]!;
    expect(root.children.map((child) => child.name)).toEqual(["Before", "Pill", "After"]);
    expect(rectangle).toMatchObject({
      type: "RECTANGLE",
      x: 10,
      y: 20,
      width: 216,
      height: 105,
      rotation: 4,
      cornerRadius: 52.5,
      opacity: 0.7,
      fills: vector.fills,
      strokes: vector.strokes,
      effects: vector.effects,
    });
    expect(sceneContract(rectangle)).toMatchInlineSnapshot(`
      {
        "children": [],
        "cornerRadius": 52.5,
        "effects": [
          {
            "type": "DROP_SHADOW",
          },
        ],
        "fills": [
          {
            "color": "#6750A4",
            "type": "SOLID",
          },
        ],
        "name": "Pill",
        "opacity": 0.7,
        "position": {
          "x": 10,
          "y": 20,
        },
        "rotation": 4,
        "size": {
          "height": 105,
          "width": 216,
        },
        "strokes": [
          {
            "color": "#000000",
            "type": "SOLID",
          },
        ],
        "type": "RECTANGLE",
      }
    `);
    expect(vector.removed).toBe(true);
  });

  it("creates named theme variables and binds paints, radii, padding, and gaps", async () => {
    const state = installRuntime();
    const root = node("FRAME", {
      name: "Button",
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      cornerRadius: 16,
    });
    const surface = node("RECTANGLE", {
      name: "Surface",
      cornerRadius: 16,
      fills: [{ type: "SOLID", color: { r: 0.4039, g: 0.3137, b: 0.6431 } }],
    });
    append(root, surface);

    const bound = await bindImportedVariables(
      root as unknown as SceneNode,
      '<g id="Surface" data-token="primary"></g>',
      {
        name: "Material 3",
        modes: { light: "Light", dark: "Dark" },
        defaultModeId: "light",
        variables: [
          { name: "color/primary", resolvedType: "COLOR", valuesByMode: { light: "#6750A4", dark: "#D0BCFF" } },
          { name: "radius/medium", resolvedType: "FLOAT", valuesByMode: { light: 16, dark: 16 } },
          { name: "spacing/small", resolvedType: "FLOAT", valuesByMode: { light: 8, dark: 8 } },
        ],
      },
    );

    expect(bound).toBe(8);
    expect(state.collections).toHaveLength(1);
    expect(state.collections[0]).toMatchObject({
      name: "Material 3",
      modes: [{ name: "Light" }, { name: "Dark" }],
      pluginData: { designParity: "tokens" },
    });
    expect(state.variables.map((variable) => ({
      name: variable.name,
      scopes: variable.scopes,
      android: variable.codeSyntax.ANDROID,
    }))).toEqual([
      { name: "color/primary", scopes: ["ALL_FILLS", "STROKE_COLOR"], android: "MaterialTheme.colorScheme.primary" },
      { name: "radius/medium", scopes: ["CORNER_RADIUS"], android: "MaterialTheme.shapes.medium" },
      { name: "spacing/small", scopes: ["GAP"], android: undefined },
    ]);
    expect((surface.fills[0] as SolidPaint).boundVariables?.color).toMatchObject({
      type: "VARIABLE_ALIAS",
      id: state.variables[0]!.id,
    });
    expect(surface.boundVariables.cornerRadius).toBe(state.variables[1]);
    expect(root.boundVariables).toMatchObject({
      cornerRadius: state.variables[1],
      itemSpacing: state.variables[2],
      paddingTop: state.variables[2],
      paddingRight: state.variables[2],
      paddingBottom: state.variables[2],
      paddingLeft: state.variables[2],
    });
  });

  it("loads the requested face, creates a named text style, and binds exact text", async () => {
    const state = installRuntime([
      { family: "Roboto", style: "Regular" },
      { family: "Roboto", style: "Medium" },
    ]);
    const root = node("FRAME");
    const label = node("TEXT", {
      name: "Label",
      characters: "Continue",
      fontName: { family: "Roboto", style: "Medium" },
      fontSize: 14,
    });
    append(root, label);

    const preflight = await preflightSvgFonts(
      '<text font-family="Roboto" font-weight="500">Continue</text><text font-family="Missing Sans">Missing</text>',
    );
    const bound = await bindImportedTextStyles(root as unknown as SceneNode, [{
      name: "typography/labelLarge",
      fontFamily: "Roboto",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      letterSpacing: 0.1,
      androidCodeSyntax: "MaterialTheme.typography.labelLarge",
    }]);

    expect(preflight).toEqual({
      loaded: [{ family: "Roboto", style: "Medium" }],
      missing: ["Missing Sans"],
    });
    expect(bound).toBe(1);
    expect(state.loadedFonts).toEqual([
      { family: "Roboto", style: "Medium" },
      { family: "Roboto", style: "Medium" },
    ]);
    expect(state.textStyles[0]).toMatchObject({
      name: "typography/labelLarge",
      fontName: { family: "Roboto", style: "Medium" },
      fontSize: 14,
      lineHeight: { unit: "PIXELS", value: 20 },
      letterSpacing: { unit: "PIXELS", value: 0.1 },
      description: "Code: MaterialTheme.typography.labelLarge",
    });
    expect(label.textStyleId).toBe(state.textStyles[0]!.id);
  });
});
