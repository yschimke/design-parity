import { afterEach, describe, expect, it } from "vitest";

import {
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
  appendChild(child: RuntimeNode): void;
  insertChild(index: number, child: RuntimeNode): void;
  resize(width: number, height: number): void;
  remove(): void;
  findAll(predicate: (node: RuntimeNode) => boolean): RuntimeNode[];
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
    ...values,
  } satisfies RuntimeNode;
  return result;
}

function detach(child: RuntimeNode): void {
  if (!child.parent) return;
  child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
  child.parent = undefined;
}

function installRuntime(): void {
  globalThis.figma = {
    createFrame: () => node("FRAME"),
    createRectangle: () => node("RECTANGLE"),
  } as unknown as PluginAPI;
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
});
