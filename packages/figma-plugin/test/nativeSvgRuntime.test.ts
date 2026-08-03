import { afterEach, describe, expect, it } from "vitest";

import {
  bindImportedTextStyles,
  bindImportedVariables,
  preflightSvgFonts,
  promoteNativeContainers,
  promoteNativeRoundedRects,
} from "../figma/nativeSvg.js";

type NodeType = "FRAME" | "GROUP" | "RECTANGLE" | "TEXT" | "VECTOR";

interface RuntimeNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  blendMode: string;
  effects: unknown[];
  fills: unknown[];
  strokes: unknown[];
  strokeWeight: number;
  cornerRadius: number;
  visible: boolean;
  removed: boolean;
  parent?: RuntimeNode;
  children: RuntimeNode[];
  clipsContent?: boolean;
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
  primaryAxisSizingMode?: "FIXED";
  counterAxisSizingMode?: "FIXED";
  primaryAxisAlignItems?: "MIN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fontName?: FontName;
  fontSize?: number;
  characters?: string;
  textStyleId?: string;
  boundVariables: Record<string, RuntimeVariable>;
  explicitModes: Record<string, string>;
  appendChild(child: RuntimeNode): void;
  insertChild(index: number, child: RuntimeNode): void;
  resize(width: number, height: number): void;
  remove(): void;
  findAll(predicate: (node: RuntimeNode) => boolean): RuntimeNode[];
  setBoundVariable(field: string, variable: RuntimeVariable): void;
  setExplicitVariableModeForCollection(collection: RuntimeCollection, modeId: string): void;
  setTextStyleIdAsync(id: string): Promise<void>;
}

interface RuntimeCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
  pluginData: Record<string, string>;
  renameMode(modeId: string, name: string): void;
  addMode(name: string): string;
  setPluginData(key: string, value: string): void;
}

interface RuntimeVariable {
  id: string;
  name: string;
  resolvedType: VariableResolvedDataType;
  variableCollectionId: string;
  scopes: VariableScope[];
  values: Record<string, VariableValue>;
  codeSyntax: Record<string, string>;
  setValueForMode(modeId: string, value: VariableValue): void;
  setVariableCodeSyntax(platform: string, syntax: string): void;
}

interface RuntimeTextStyle {
  id: string;
  name: string;
  fontName: FontName;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  description: string;
}

interface RuntimeState {
  collections: RuntimeCollection[];
  variables: RuntimeVariable[];
  textStyles: RuntimeTextStyle[];
  loadedFonts: FontName[];
}

let nextId = 0;
const previousFigma = globalThis.figma;

function node(type: NodeType, values: Partial<RuntimeNode> = {}): RuntimeNode {
  const result = {
    id: `${nextId++}:0`,
    type,
    name: type === "VECTOR" ? "Vector" : type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    blendMode: "PASS_THROUGH",
    effects: [],
    fills: [],
    strokes: [],
    strokeWeight: 1,
    cornerRadius: 0,
    visible: true,
    removed: false,
    children: [],
    layoutMode: "NONE",
    boundVariables: {},
    explicitModes: {},
    appendChild(child: RuntimeNode): void {
      detach(child);
      child.parent = result;
      result.children.push(child);
    },
    insertChild(index: number, child: RuntimeNode): void {
      detach(child);
      child.parent = result;
      result.children.splice(index, 0, child);
    },
    resize(width: number, height: number): void {
      result.width = width;
      result.height = height;
    },
    remove(): void {
      detach(result);
      result.removed = true;
    },
    findAll(predicate: (candidate: RuntimeNode) => boolean): RuntimeNode[] {
      const found: RuntimeNode[] = [];
      const visit = (candidate: RuntimeNode): void => {
        if (predicate(candidate)) found.push(candidate);
        candidate.children.forEach(visit);
      };
      result.children.forEach(visit);
      return found;
    },
    setBoundVariable(field: string, variable: RuntimeVariable): void {
      result.boundVariables[field] = variable;
    },
    setExplicitVariableModeForCollection(collection: RuntimeCollection, modeId: string): void {
      result.explicitModes[collection.id] = modeId;
    },
    async setTextStyleIdAsync(id: string): Promise<void> {
      result.textStyleId = id;
    },
    ...values,
  } satisfies RuntimeNode;
  return result;
}

function detach(child: RuntimeNode): void {
  if (!child.parent) return;
  child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
  child.parent = undefined;
}

function installRuntime(fonts: FontName[] = []): RuntimeState {
  const state: RuntimeState = { collections: [], variables: [], textStyles: [], loadedFonts: [] };
  globalThis.figma = {
    createFrame: () => node("FRAME"),
    createRectangle: () => node("RECTANGLE"),
    listAvailableFontsAsync: async () => fonts.map((fontName) => ({ fontName })),
    loadFontAsync: async (font: FontName) => { state.loadedFonts.push(font); },
    getLocalTextStylesAsync: async () => state.textStyles,
    createTextStyle: () => {
      const style: RuntimeTextStyle = {
        id: `style-${state.textStyles.length}`,
        name: "",
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 12,
        lineHeight: { unit: "AUTO" },
        letterSpacing: { unit: "PIXELS", value: 0 },
        description: "",
      };
      state.textStyles.push(style);
      return style;
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => state.collections,
      getLocalVariablesAsync: async () => state.variables,
      createVariableCollection: (name: string) => {
        const collection: RuntimeCollection = {
          id: `collection-${state.collections.length}`,
          name,
          modes: [{ modeId: "mode-0", name: "Mode 1" }],
          defaultModeId: "mode-0",
          pluginData: {},
          renameMode(modeId: string, modeName: string): void {
            const mode = collection.modes.find((candidate) => candidate.modeId === modeId);
            if (mode) mode.name = modeName;
          },
          addMode(modeName: string): string {
            const modeId = `mode-${collection.modes.length}`;
            collection.modes.push({ modeId, name: modeName });
            return modeId;
          },
          setPluginData(key: string, value: string): void {
            collection.pluginData[key] = value;
          },
        };
        state.collections.push(collection);
        return collection;
      },
      createVariable: (name: string, collection: RuntimeCollection, resolvedType: VariableResolvedDataType) => {
        const variable: RuntimeVariable = {
          id: `variable-${state.variables.length}`,
          name,
          resolvedType,
          variableCollectionId: collection.id,
          scopes: [],
          values: {},
          codeSyntax: {},
          setValueForMode(modeId: string, value: VariableValue): void { variable.values[modeId] = value; },
          setVariableCodeSyntax(platform: string, syntax: string): void { variable.codeSyntax[platform] = syntax; },
        };
        state.variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint: (paint: SolidPaint, _field: string, variable: RuntimeVariable) => ({
        ...paint,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
      }),
    },
  } as unknown as PluginAPI;
  return state;
}

function append(parent: RuntimeNode, ...children: RuntimeNode[]): RuntimeNode {
  children.forEach((child) => parent.appendChild(child));
  return parent;
}

afterEach(() => {
  nextId = 0;
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
