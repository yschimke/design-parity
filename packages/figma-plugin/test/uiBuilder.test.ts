import { describe, expect, it } from "vitest";

import {
  buildUiBuilderScene,
  componentsByName,
  formatHexColour,
  fontStyleFor,
  parseHexColour,
  readUiBuilderSnapshot,
  SCENE_SCHEMA,
  UI_BUILDER_NAMESPACE,
  type UiFigmaApi,
  type UiFigmaNode,
  type UiScene,
  type UiSceneNode,
  type UiSolidPaint,
  type UiVariable,
} from "../src/uiBuilder.js";

/**
 * A fake of the slice of the plugin API the builder bridge uses. It enforces
 * the two sizing rules real Figma enforces — FILL only inside auto layout, HUG
 * only on an auto-layout frame or a text child of one — so a scene that would
 * throw in Figma throws here too.
 */
function fakeFigma(variables: UiVariable[] = []) {
  let ids = 0;
  const node = (type: string, extra: Partial<UiFigmaNode> = {}): UiFigmaNode => {
    const data: Record<string, Record<string, string>> = {};
    const children: UiFigmaNode[] = [];
    let horizontal: string | undefined;
    let vertical: string | undefined;
    const self: UiFigmaNode = {
      id: `${++ids}:1`,
      type,
      name: "",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children,
      parent: null,
      layoutMode: type === "FRAME" ? "NONE" : undefined,
      appendChild(child) {
        children.push(child);
        child.parent = self;
      },
      resize(w, h) {
        self.width = w;
        self.height = h;
      },
      setSharedPluginData(ns, key, value) {
        (data[ns] ??= {})[key] = value;
      },
      getSharedPluginData(ns, key) {
        return data[ns]?.[key] ?? "";
      },
      ...extra,
    };
    const check = (mode: string) => {
      const parentAuto = self.parent?.layoutMode === "HORIZONTAL" || self.parent?.layoutMode === "VERTICAL";
      const selfAuto = self.layoutMode === "HORIZONTAL" || self.layoutMode === "VERTICAL";
      if (mode === "FILL" && !parentAuto) throw new Error("FILL can only be set on children of auto-layout frames");
      if (mode === "HUG" && !(selfAuto || (self.type === "TEXT" && parentAuto))) {
        throw new Error("HUG is not valid here");
      }
    };
    Object.defineProperty(self, "layoutSizingHorizontal", {
      get: () => horizontal,
      set: (m: string) => {
        check(m);
        horizontal = m;
      },
      enumerable: true,
    });
    Object.defineProperty(self, "layoutSizingVertical", {
      get: () => vertical,
      set: (m: string) => {
        check(m);
        vertical = m;
      },
      enumerable: true,
    });
    return self;
  };
  const byId = new Map(variables.map((v) => [v.id, v]));
  const fonts: string[] = [];
  const figma: UiFigmaApi = {
    fileKey: "fakeFile",
    createFrame: () => node("FRAME"),
    createText: () => node("TEXT", { characters: "" }),
    loadFontAsync: async (f) => {
      fonts.push(`${f.family} ${f.style}`);
    },
    getLocalTextStylesAsync: async () => [{ id: "S:1", name: "M3/body/large" }],
    getStyleByIdAsync: async (id) => (id === "S:1" ? { id, name: "M3/body/large" } : null),
    variables: {
      getLocalVariablesAsync: async () => variables,
      getVariableByIdAsync: async (id) => byId.get(id) ?? null,
      setBoundVariableForPaint: (paint: UiSolidPaint, _field, variable) => ({
        ...paint,
        boundVariables: { color: { id: variable.id } },
      }),
    },
  };
  // Text nodes get a style setter that records the id, as Figma's does.
  const createText = figma.createText;
  figma.createText = () => {
    const t = createText();
    t.setTextStyleIdAsync = async (id) => {
      t.textStyleId = id;
    };
    return t;
  };
  return { figma, fonts, node };
}

const stamp = (nodeId: string, extra: Record<string, string> = {}) => ({
  designId: "checkout",
  nodeId,
  revision: 12,
  ...extra,
});

const scene: UiScene = {
  schema: SCENE_SCHEMA,
  designId: "checkout",
  revision: 12,
  catalog: "m3-catalog",
  root: {
    id: "root",
    type: "FRAME",
    name: "Checkout",
    width: 412,
    height: 915,
    layout: { mode: "VERTICAL", itemSpacing: 16, padding: { left: 24, top: 24, right: 24, bottom: 24 } },
    sizing: { horizontal: "FIXED", vertical: "FIXED" },
    fill: { color: "#FFFEF7FF", variable: "Schemes/Surface" },
    stamp: stamp("root", { componentId: "layout/column" }),
    children: [
      {
        id: "title",
        type: "TEXT",
        name: "Checkout",
        sizing: { horizontal: "FILL", vertical: "HUG" },
        text: { characters: "Checkout", style: "M3/body/large", fontWeight: 600 },
        stamp: stamp("title", { componentId: "m3/text", slot: "children" }),
      },
      {
        id: "line",
        type: "FRAME",
        name: "line",
        layout: { mode: "HORIZONTAL", itemSpacing: 8, primaryAxisAlign: "SPACE_BETWEEN", counterAxisAlign: "CENTER" },
        sizing: { horizontal: "FILL", vertical: "HUG" },
        stamp: stamp("line", { componentId: "layout/row", slot: "children" }),
        children: [],
      },
      {
        id: "promo",
        type: "FRAME",
        name: "promo",
        width: 364,
        height: 120,
        layout: { mode: "NONE" },
        sizing: { horizontal: "FILL", vertical: "FIXED" },
        cornerRadius: 16,
        fill: { color: "#FFF3EDF7" },
        stamp: stamp("promo", { componentId: "layout/box", slot: "children" }),
        children: [],
      },
      {
        id: "pay",
        type: "INSTANCE",
        name: "pay",
        sizing: { horizontal: "FILL", vertical: "HUG" },
        instance: {
          componentSet: "Button",
          component: "State=Enabled, Label text=Pay",
          properties: { State: "Enabled", "Label text": "Pay" },
        },
        stamp: stamp("pay", { componentId: "m3/button", slot: "children", labelNodeId: "pay-label" }),
      },
    ],
  },
};

function walk(node: UiSceneNode): UiSceneNode[] {
  return [node, ...(node.children ?? []).flatMap(walk)];
}

describe("buildUiBuilderScene", () => {
  it("builds auto layout, text and a stand-in, stamping every node", async () => {
    const { figma, fonts, node } = fakeFigma([{ id: "V:1", name: "Schemes/Surface" }]);
    const page = node("FRAME");
    const result = await buildUiBuilderScene(figma, scene, { parent: page });
    expect(result.standIns).toEqual(["pay"]);
    expect(result.unresolvedTokens).toEqual([]);
    expect(result.rootId).toBe(page.children![0].id);
    expect(fonts).toContain("Inter Semi Bold");
    const root = page.children![0];
    expect(JSON.parse(root.getSharedPluginData(UI_BUILDER_NAMESPACE, "stamp"))).toMatchObject({
      designId: "checkout",
      nodeId: "root",
      revision: 12,
    });
  });

  it("names the variables and styles the file does not have", async () => {
    const { figma } = fakeFigma();
    const result = await buildUiBuilderScene(figma, scene);
    expect(result.unresolvedTokens).toEqual(["variable Schemes/Surface"]);
  });

  it("refuses something that is not a scene", async () => {
    const { figma } = fakeFigma();
    await expect(buildUiBuilderScene(figma, { ...scene, schema: "nope" })).rejects.toThrow(/expected/);
  });
});

describe("buildUiBuilderScene → readUiBuilderSnapshot", () => {
  async function roundTrip(variables: UiVariable[] = [{ id: "V:1", name: "Schemes/Surface" }]) {
    const { figma, node } = fakeFigma(variables);
    const page = node("FRAME");
    await buildUiBuilderScene(figma, scene, { parent: page });
    const built = page.children![0];
    return { figma, built, snapshot: await readUiBuilderSnapshot(figma, built) };
  }

  it("reads back every stamp, in order", async () => {
    const { snapshot } = await roundTrip();
    expect(walk(snapshot.root).map((n) => n.stamp?.nodeId)).toEqual(walk(scene.root).map((n) => n.id));
  });

  it("reads layout, sizing, tokens and text the way it was built", async () => {
    const { snapshot } = await roundTrip();
    const root = snapshot.root;
    expect(root.layout).toMatchObject({ mode: "VERTICAL", itemSpacing: 16, padding: { left: 24, top: 24 } });
    expect(root.fill).toEqual({ color: "#FFFEF7FF", variable: "Schemes/Surface" });
    const [title, line, promo] = root.children!;
    expect(title.sizing).toEqual({ horizontal: "FILL", vertical: "HUG" });
    expect(title.text).toMatchObject({ characters: "Checkout", style: "M3/body/large", fontWeight: 600 });
    expect(line.layout).toMatchObject({ mode: "HORIZONTAL", primaryAxisAlign: "SPACE_BETWEEN", counterAxisAlign: "CENTER" });
    expect(promo).toMatchObject({ width: 364, height: 120, cornerRadius: 16 });
    expect(promo.sizing).toEqual({ horizontal: "FILL", vertical: "FIXED" });
  });

  it("does not report the colour Figma gave text the scene left unfilled", async () => {
    const { figma, built } = await roundTrip();
    const title = built.children![0];
    title.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    expect((await readUiBuilderSnapshot(figma, built)).root.children![0].fill).toBeUndefined();
    title.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    expect((await readUiBuilderSnapshot(figma, built)).root.children![0].fill).toEqual({
      color: "#FFFF0000",
    });
  });

  it("reads a stand-in back as the instance it stands in for, its label from the text layer", async () => {
    const { built, figma } = await roundTrip();
    const payFrame = built.children![3];
    expect(payFrame.getSharedPluginData(UI_BUILDER_NAMESPACE, "instance")).toContain("Button");
    // A designer edits the label on the canvas.
    payFrame.children![0].characters = "Pay now";
    const pay = (await readUiBuilderSnapshot(figma, built)).root.children![3];
    expect(pay.type).toBe("INSTANCE");
    expect(pay.instance).toEqual({
      componentSet: "Button",
      component: "State=Enabled, Label text=Pay",
      properties: { State: "Enabled", "Label text": "Pay now" },
    });
    expect(pay.stamp?.labelNodeId).toBe("pay-label");
  });

  it("uses a kit component the file has, setting its properties by their own keys", async () => {
    const { figma, node } = fakeFigma();
    let set: Record<string, string | boolean> = {};
    const variant = node("COMPONENT", {
      name: "State=Enabled",
      createInstance: () =>
        node("INSTANCE", {
          componentProperties: {
            State: { type: "VARIANT", value: "Enabled" },
            "Label text#12:0": { type: "TEXT", value: "Button" },
          },
          setProperties: (p) => {
            set = p;
          },
        }),
    });
    const kitSet = node("COMPONENT_SET", { name: "Button", defaultVariant: variant });
    const page = node("FRAME");
    const result = await buildUiBuilderScene(figma, scene, {
      parent: page,
      resolveComponent: componentsByName([kitSet]),
    });
    expect(result.standIns).toEqual([]);
    expect(set).toEqual({ State: "Enabled", "Label text#12:0": "Pay" });
  });
});

describe("colour and font helpers", () => {
  it("round-trips #AARRGGBB", () => {
    const parsed = parseHexColour("#80FF0000")!;
    expect(parsed.opacity).toBeCloseTo(0.502, 2);
    expect(formatHexColour(parsed.color, parsed.opacity)).toBe("#80FF0000");
    expect(parseHexColour("#1D1B20")?.opacity).toBe(1);
    expect(parseHexColour("surface")).toBeUndefined();
  });

  it("picks Figma's font style names", () => {
    expect(fontStyleFor(600)).toBe("Semi Bold");
    expect(fontStyleFor(400, true)).toBe("Italic");
    expect(fontStyleFor(700, true)).toBe("Bold Italic");
  });
});
