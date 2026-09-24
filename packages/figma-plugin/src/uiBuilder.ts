/**
 * The Compose UI builder ↔ Figma bridge, main-thread half.
 *
 * Two operations over the contracts `yschimke/compose-ui-builder` owns (see
 * its `docs/design/UI_BUILDER_FIGMA_INTEGRATION.md`):
 *
 * - {@link buildUiBuilderScene} builds a `compose-ui-builder-figma-scene/v1`
 *   — auto-layout frames, kit instances, text — and stamps every node it
 *   creates under the `composeUiBuilder` shared-plugin-data namespace;
 * - {@link readUiBuilderSnapshot} reads any frame back as a
 *   `compose-ui-builder-figma-snapshot/v1`, stamps included, which the
 *   builder imports as a design or reconciles into a command.
 *
 * Deliberately separate from the catalog importer's {@link FigmaApi}: the
 * builder's nodes are live layout (auto layout, instances, bound variables),
 * not placed renders, so they need a different — and narrower — slice of the
 * plugin API. Both functions take it injected and run headlessly under the
 * tests; the same bundle runs inside a plugin or through the Figma MCP's
 * `use_figma`.
 */

/** The shared-plugin-data namespace every builder stamp lives under. */
export const UI_BUILDER_NAMESPACE = "composeUiBuilder";
export const SCENE_SCHEMA = "compose-ui-builder-figma-scene/v1";
export const SNAPSHOT_SCHEMA = "compose-ui-builder-figma-snapshot/v1";
/** What Figma fills a text node with when nothing else does. */
const DEFAULT_TEXT_FILL = "#FF000000";

// ---------------------------------------------------------------- contracts

export interface UiStamp {
  designId: string;
  nodeId: string;
  revision: number;
  componentId?: string;
  slot?: string;
  labelNodeId?: string;
}

export interface UiPaint {
  color?: string;
  variable?: string;
}

export interface UiLayout {
  mode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  itemSpacing?: number;
  padding?: { left?: number; top?: number; right?: number; bottom?: number };
  primaryAxisAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlign?: "MIN" | "CENTER" | "MAX";
}

export type UiSizingMode = "FIXED" | "HUG" | "FILL";

export interface UiText {
  characters: string;
  style?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  textAlign?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}

export interface UiInstance {
  componentSet?: string;
  component?: string;
  properties?: Record<string, string | number | boolean>;
}

/** One node of a scene or a snapshot: the two contracts share this shape. */
export interface UiSceneNode {
  id: string;
  type: string;
  name?: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layout?: UiLayout;
  sizing?: { horizontal?: UiSizingMode; vertical?: UiSizingMode };
  fill?: UiPaint;
  stroke?: UiPaint & { weight?: number };
  cornerRadius?: number;
  imageFill?: boolean;
  text?: UiText;
  instance?: UiInstance;
  stamp?: UiStamp;
  children?: UiSceneNode[];
}

export interface UiScene {
  schema: string;
  designId: string;
  revision: number;
  catalog: string;
  root: UiSceneNode;
}

export interface UiSnapshot {
  schema: string;
  source: { fileKey?: string; nodeId?: string };
  root: UiSceneNode;
}

// ------------------------------------------------------- the API we depend on

export interface UiRgb {
  r: number;
  g: number;
  b: number;
}

export interface UiSolidPaint {
  type: string;
  color?: UiRgb;
  opacity?: number;
  visible?: boolean;
  boundVariables?: { color?: { id: string } };
}

/** The members of Figma's scene nodes this module touches. */
export interface UiFigmaNode {
  id: string;
  type: string;
  name: string;
  visible?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: readonly UiFigmaNode[];
  parent?: UiFigmaNode | null;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  layoutSizingHorizontal?: UiSizingMode;
  layoutSizingVertical?: UiSizingMode;
  fills?: readonly UiSolidPaint[] | symbol;
  strokes?: readonly UiSolidPaint[];
  strokeWeight?: number | symbol;
  cornerRadius?: number | symbol;
  clipsContent?: boolean;
  characters?: string;
  fontSize?: number | symbol;
  fontName?: { family: string; style: string } | symbol;
  textAlignHorizontal?: string;
  textAutoResize?: string;
  textStyleId?: string | symbol;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
  variantProperties?: Record<string, string> | null;
  appendChild(child: UiFigmaNode): void;
  resize(width: number, height: number): void;
  setSharedPluginData(namespace: string, key: string, value: string): void;
  getSharedPluginData(namespace: string, key: string): string;
  getMainComponentAsync?(): Promise<UiFigmaNode | null>;
  setProperties?(properties: Record<string, string | boolean>): void;
  setTextStyleIdAsync?(id: string): Promise<void>;
  createInstance?(): UiFigmaNode;
  defaultVariant?: UiFigmaNode;
}

export interface UiVariable {
  id: string;
  name: string;
}

export interface UiStyle {
  id: string;
  name: string;
  /** A text style's font, which has to be loaded before the style can be applied. */
  fontName?: { family: string; style: string };
}

/** The subset of Figma's `PluginAPI` the builder bridge uses. */
export interface UiFigmaApi {
  fileKey?: string;
  mixed?: symbol;
  createFrame(): UiFigmaNode;
  createText(): UiFigmaNode;
  loadFontAsync(font: { family: string; style: string }): Promise<void>;
  getStyleByIdAsync?(id: string): Promise<UiStyle | null>;
  getLocalTextStylesAsync?(): Promise<UiStyle[]>;
  variables: {
    getLocalVariablesAsync(type?: string): Promise<UiVariable[]>;
    getVariableByIdAsync(id: string): Promise<UiVariable | null>;
    setBoundVariableForPaint(
      paint: UiSolidPaint,
      field: "color",
      variable: UiVariable,
    ): UiSolidPaint;
  };
}

/** How the builder finds a kit component: by set (or component) name. */
export type ComponentResolver = (
  instance: UiInstance,
) => Promise<UiFigmaNode | null> | UiFigmaNode | null;

export interface BuildOptions {
  /** Where the scene's root frame is appended; the page when omitted. */
  parent?: UiFigmaNode;
  /** Finds the kit component for an instance; none found means a stand-in. */
  resolveComponent?: ComponentResolver;
  /** Font family for text. Inter is available in every Figma file. */
  fontFamily?: string;
}

export interface BuildResult {
  rootId: string;
  created: number;
  /** Instances no kit component was found for, built as labelled frames. */
  standIns: string[];
  /** Variables and text styles the scene named that this file does not have. */
  unresolvedTokens: string[];
  /**
   * Instance properties the resolved kit component does not have, as `<node id>: <property>` —
   * a library that renamed a property builds with its default, and says so here.
   */
  unappliedProperties?: string[];
}

// ------------------------------------------------------------------- colour

/** `#AARRGGBB` or `#RRGGBB` → Figma's 0–1 channels and opacity. */
export function parseHexColour(hex: string): { color: UiRgb; opacity: number } | undefined {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  const v = m?.[1];
  if (!v) return undefined;
  const has = v.length === 8;
  const byte = (i: number) => parseInt(v.slice(i, i + 2), 16) / 255;
  const a = has ? byte(0) : 1;
  const o = has ? 2 : 0;
  return { color: { r: byte(o), g: byte(o + 2), b: byte(o + 4) }, opacity: a };
}

/** Figma's channels and opacity → `#AARRGGBB`, the builder's literal form. */
export function formatHexColour(color: UiRgb, opacity = 1): string {
  const byte = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${byte(opacity)}${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

// -------------------------------------------------------------------- fonts

/** Figma's style names for each weight, as Inter and most variable families spell them. */
const WEIGHT_STYLES: [number, string][] = [
  [100, "Thin"],
  [200, "Extra Light"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semi Bold"],
  [700, "Bold"],
  [800, "Extra Bold"],
  [900, "Black"],
];

export function fontStyleFor(weight = 400, italic = false): string {
  const nearest = WEIGHT_STYLES.reduce((best, w) =>
    Math.abs(w[0] - weight) < Math.abs(best[0] - weight) ? w : best,
  )[1];
  if (!italic) return nearest;
  return nearest === "Regular" ? "Italic" : `${nearest} Italic`;
}

/** The inverse of {@link fontStyleFor}: every weight it writes reads back as itself. */
export function weightForStyle(style: string): number {
  const s = style.toLowerCase().replace(/italic/, "").replace(/[\s-]+/g, " ").trim();
  if (s.includes("thin") || s.includes("hairline")) return 100;
  if ((s.includes("extra") || s.includes("ultra")) && s.includes("light")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("semi") || s.includes("demi")) return 600;
  if ((s.includes("extra") || s.includes("ultra")) && s.includes("bold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  if (s.includes("medium")) return 500;
  return 400;
}

// -------------------------------------------------------------------- build

/**
 * Build a scene. Every created node is stamped; an instance whose kit
 * component {@link BuildOptions.resolveComponent} cannot find is built as a
 * frame named for it, its label as a text layer, and the requested instance
 * recorded in the stamp so {@link readUiBuilderSnapshot} reads it back as the
 * same instance — the round trip works in a file with no kit at all.
 */
export async function buildUiBuilderScene(
  figma: UiFigmaApi,
  scene: UiScene,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  if (scene.schema !== SCENE_SCHEMA) {
    throw new Error(`expected ${SCENE_SCHEMA}, found ${scene.schema}`);
  }
  const family = opts.fontFamily ?? "Inter";
  const variables = new Map(
    (await figma.variables.getLocalVariablesAsync("COLOR")).map((v) => [v.name, v]),
  );
  const textStyles = new Map(
    ((await figma.getLocalTextStylesAsync?.()) ?? []).map((s) => [s.name, s]),
  );
  const result: BuildResult = { rootId: "", created: 0, standIns: [], unresolvedTokens: [] };
  const unresolved = new Set<string>();

  const paint = (p: UiPaint | undefined): UiSolidPaint[] | undefined => {
    if (!p) return undefined;
    const literal = p.color ? parseHexColour(p.color) : undefined;
    let solid: UiSolidPaint = {
      type: "SOLID",
      color: literal?.color ?? { r: 0.5, g: 0.5, b: 0.5 },
      opacity: literal?.opacity ?? 1,
    };
    if (p.variable) {
      const variable = variables.get(p.variable);
      if (variable) solid = figma.variables.setBoundVariableForPaint(solid, "color", variable);
      else unresolved.add(`variable ${p.variable}`);
    }
    return [solid];
  };

  const stamp = (node: UiFigmaNode, s: UiStamp | undefined, instance?: UiInstance) => {
    if (s) node.setSharedPluginData(UI_BUILDER_NAMESPACE, "stamp", JSON.stringify(s));
    if (instance) {
      node.setSharedPluginData(UI_BUILDER_NAMESPACE, "instance", JSON.stringify(instance));
    }
    result.created++;
  };

  const text = async (n: UiSceneNode, t: UiText): Promise<UiFigmaNode> => {
    const node = figma.createText();
    const style = t.style ? textStyles.get(t.style) : undefined;
    if (t.style && !(style && node.setTextStyleIdAsync)) unresolved.add(`text style ${t.style}`);
    const font = { family, style: fontStyleFor(t.fontWeight ?? 400, t.italic ?? false) };
    await figma.loadFontAsync(font);
    node.fontName = font;
    node.characters = t.characters;
    if (style && node.setTextStyleIdAsync) {
      // A style owns the layer's typography, as the builder's importer reads it: an explicit size
      // or weight set over it would detach the style, and one set before it is overwritten.
      if (style.fontName) await figma.loadFontAsync(style.fontName);
      await node.setTextStyleIdAsync(style.id);
    } else if (t.fontSize) {
      node.fontSize = t.fontSize;
    }
    if (t.textAlign) node.textAlignHorizontal = t.textAlign;
    const fills = paint(n.fill);
    if (fills) node.fills = fills;
    // Figma paints unfilled text black; the builder's text takes the theme's content colour.
    // Remember the default was ours, so reading it back does not report an edit.
    else node.setSharedPluginData(UI_BUILDER_NAMESPACE, "defaultFill", DEFAULT_TEXT_FILL);
    return node;
  };

  const build = async (n: UiSceneNode, parent: UiFigmaNode | undefined): Promise<UiFigmaNode> => {
    let node: UiFigmaNode;
    let requested: UiInstance | undefined;
    if (n.type === "TEXT" && n.text) {
      node = await text(n, n.text);
    } else if (n.type === "INSTANCE" && n.instance) {
      const component = await opts.resolveComponent?.(n.instance);
      if (component?.createInstance) {
        node = component.createInstance();
        for (const missing of applyInstanceProperties(node, n.instance.properties ?? {})) {
          (result.unappliedProperties ??= []).push(`${n.id}: ${missing}`);
        }
      } else {
        requested = n.instance;
        result.standIns.push(n.id);
        node = standInFrame(figma, n.instance);
        const label = labelOf(n.instance);
        if (label !== undefined) node.appendChild(await text({ id: `${n.id}-label`, type: "TEXT" }, { characters: label }));
      }
    } else {
      node = figma.createFrame();
      node.clipsContent = false;
      node.fills = paint(n.fill) ?? [];
      const layout = n.layout ?? {};
      node.layoutMode = layout.mode ?? "NONE";
      if (node.layoutMode !== "NONE") {
        node.itemSpacing = layout.itemSpacing ?? 0;
        node.paddingLeft = layout.padding?.left ?? 0;
        node.paddingTop = layout.padding?.top ?? 0;
        node.paddingRight = layout.padding?.right ?? 0;
        node.paddingBottom = layout.padding?.bottom ?? 0;
        node.primaryAxisAlignItems = layout.primaryAxisAlign ?? "MIN";
        node.counterAxisAlignItems = layout.counterAxisAlign ?? "MIN";
      }
      if (n.stroke) {
        node.strokes = paint(n.stroke) ?? [];
        node.strokeWeight = n.stroke.weight ?? 1;
      }
      if (n.cornerRadius) node.cornerRadius = n.cornerRadius;
    }
    node.name = n.stamp && n.type !== "INSTANCE" && n.name ? n.name : n.name ?? n.id;
    if (n.visible === false) node.visible = false;
    stamp(node, n.stamp, requested);

    // Size first: resize() resets sizing modes, so they are set after parenting.
    const w = n.width && n.width > 0 ? n.width : undefined;
    const h = n.height && n.height > 0 ? n.height : undefined;
    if (n.type !== "TEXT" && (w || h)) node.resize(w ?? node.width ?? 1, h ?? node.height ?? 1);
    if (n.type === "TEXT" && n.sizing?.horizontal === "FIXED" && w) {
      if (n.sizing?.vertical === "FIXED" && h) {
        // A fixed box: both dimensions, and no growing to fit the text.
        node.resize(w, h);
        node.textAutoResize = "NONE";
      } else {
        node.resize(w, node.height);
        node.textAutoResize = "HEIGHT";
      }
    }
    if (parent) {
      parent.appendChild(node);
      // A page, or any parent without auto layout, places its children by their coordinates.
      if (parent.layoutMode !== "HORIZONTAL" && parent.layoutMode !== "VERTICAL") {
        node.x = n.x ?? 0;
        node.y = n.y ?? 0;
      }
    }
    if (n.children && node.type === "FRAME") {
      for (const child of n.children) await build(child, node);
    }
    applySizing(node, n, parent);
    return node;
  };

  const root = await build(scene.root, opts.parent);
  result.rootId = root.id;
  result.unresolvedTokens = [...unresolved].sort();
  return result;
}

/**
 * Sizing modes, applied last: `HUG` is only legal on an auto-layout frame or
 * a text child of one, `FILL` only on a child of an auto-layout frame, so each
 * is set only where Figma accepts it and FIXED stands in otherwise.
 */
function applySizing(node: UiFigmaNode, n: UiSceneNode, parent: UiFigmaNode | undefined) {
  const inAutoLayout = !!parent && parent.layoutMode !== undefined && parent.layoutMode !== "NONE";
  const isAutoLayout = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
  const legal = (mode: UiSizingMode | undefined): UiSizingMode | undefined => {
    if (mode === "FILL") return inAutoLayout ? "FILL" : undefined;
    if (mode === "HUG") return isAutoLayout || (node.type === "TEXT" && inAutoLayout) ? "HUG" : undefined;
    return mode;
  };
  // A missing mode is FIXED, as the builder's contract defaults it.
  const h = legal(n.sizing?.horizontal ?? "FIXED");
  const v = legal(n.sizing?.vertical ?? "FIXED");
  if (h) node.layoutSizingHorizontal = h;
  if (v) node.layoutSizingVertical = v;
}

/** Variant axes and component properties, matched to the instance's own keys. */
function applyInstanceProperties(
  node: UiFigmaNode,
  requested: Record<string, string | number | boolean>,
): string[] {
  const missing: string[] = [];
  const own = node.componentProperties ?? {};
  const byName = new Map(Object.keys(own).map((k) => [propertyName(k).toLowerCase(), k]));
  const next: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(requested)) {
    const target = byName.get(key.toLowerCase());
    if (!target) {
      missing.push(key);
      continue;
    }
    next[target] =
      own[target]?.type === "BOOLEAN" ? value === true || value === "true" : String(value);
  }
  if (Object.keys(next).length > 0) node.setProperties?.(next);
  return missing;
}

/** A frame standing in for a kit component this file does not have. */
function standInFrame(figma: UiFigmaApi, instance: UiInstance): UiFigmaNode {
  const frame = figma.createFrame();
  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.paddingLeft = 16;
  frame.paddingRight = 16;
  frame.paddingTop = 8;
  frame.paddingBottom = 8;
  frame.cornerRadius = 20;
  frame.strokes = [{ type: "SOLID", color: { r: 0.47, g: 0.45, b: 0.5 } }];
  frame.strokeWeight = 1;
  frame.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.9, b: 0.96 } }];
  frame.name = instance.componentSet ?? instance.component ?? "Instance";
  return frame;
}

/** The label text a kit instance carries as a property, if it carries one. */
function labelOf(instance: UiInstance): string | undefined {
  const key = labelKey(instance);
  return key === undefined ? undefined : String(instance.properties![key]);
}

/**
 * The property holding an instance's label: a text value whose name says label or text — `Label
 * text` before a bare `Text`, and never a boolean such as `Show label`.
 */
export function labelKey(instance: UiInstance): string | undefined {
  const textual = Object.entries(instance.properties ?? {}).filter(
    ([, value]) => typeof value === "string",
  );
  return (
    textual.find(([k]) => /label/i.test(k))?.[0] ?? textual.find(([k]) => /text/i.test(k))?.[0]
  );
}

/** `Label text#12:0` → `Label text`. */
export function propertyName(key: string): string {
  return key.replace(/#[^#]*$/, "");
}

// --------------------------------------------------------------------- read

/**
 * Read a frame as a snapshot. Positions are relative to the parent; a solid
 * fill bound to a variable reports the variable's name; an instance reports
 * its set, its variant and its properties with keys stripped of Figma's
 * `#12:0` suffix. A stand-in frame the builder created reads back as the
 * instance it stands in for, its label taken from its text layer — so an edit
 * to the label is an edit to the instance.
 */
export async function readUiBuilderSnapshot(
  figma: UiFigmaApi,
  root: UiFigmaNode,
): Promise<UiSnapshot> {
  const variableNames = new Map<string, string>();
  const styleNames = new Map<string, string>();
  const mixed = figma.mixed;

  const variableName = async (id: string) => {
    if (!variableNames.has(id)) {
      variableNames.set(id, (await figma.variables.getVariableByIdAsync(id))?.name ?? "");
    }
    return variableNames.get(id) || undefined;
  };
  const styleName = async (id: string) => {
    if (!styleNames.has(id)) {
      styleNames.set(id, (await figma.getStyleByIdAsync?.(id))?.name ?? "");
    }
    return styleNames.get(id) || undefined;
  };
  const readPaint = async (paints: readonly UiSolidPaint[] | symbol | undefined) => {
    if (!paints || typeof paints === "symbol") return undefined;
    const solid = paints.find((p) => p.type === "SOLID" && p.visible !== false);
    if (!solid?.color) return undefined;
    const out: UiPaint = { color: formatHexColour(solid.color, solid.opacity ?? 1) };
    const bound = solid.boundVariables?.color?.id;
    if (bound) {
      const name = await variableName(bound);
      if (name) out.variable = name;
    }
    return out;
  };
  const num = (v: number | symbol | undefined): number | undefined =>
    typeof v === "number" ? v : undefined;

  const read = async (node: UiFigmaNode): Promise<UiSceneNode> => {
    const out: UiSceneNode = {
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    if (node.visible === false) out.visible = false;
    const stampText = node.getSharedPluginData(UI_BUILDER_NAMESPACE, "stamp");
    if (stampText) out.stamp = JSON.parse(stampText) as UiStamp;
    if (node.layoutSizingHorizontal || node.layoutSizingVertical) {
      out.sizing = {
        horizontal: node.layoutSizingHorizontal ?? "FIXED",
        vertical: node.layoutSizingVertical ?? "FIXED",
      };
    }
    const fills = node.fills;
    if (fills && typeof fills !== "symbol" && fills.some((f) => f.type === "IMAGE")) {
      out.imageFill = true;
    }

    if (node.type === "TEXT") {
      const font = node.fontName && typeof node.fontName !== "symbol" ? node.fontName : undefined;
      const styleId = typeof node.textStyleId === "string" && node.textStyleId ? node.textStyleId : undefined;
      out.text = {
        characters: node.characters ?? "",
        style: styleId ? await styleName(styleId) : undefined,
        fontSize: num(node.fontSize),
        fontWeight: font ? weightForStyle(font.style) : undefined,
        italic: font ? /italic/i.test(font.style) : undefined,
        textAlign:
          node.textAlignHorizontal && node.textAlignHorizontal !== "LEFT"
            ? (node.textAlignHorizontal as UiText["textAlign"])
            : undefined,
      };
      const fill = await readPaint(node.fills);
      const defaulted =
        node.getSharedPluginData(UI_BUILDER_NAMESPACE, "defaultFill") === DEFAULT_TEXT_FILL &&
        fill?.color === DEFAULT_TEXT_FILL &&
        !fill.variable;
      if (!defaulted) out.fill = fill;
      return out;
    }

    const standIn = node.getSharedPluginData(UI_BUILDER_NAMESPACE, "instance");
    if (standIn) {
      const instance = JSON.parse(standIn) as UiInstance;
      const labelLayer = (node.children ?? []).find((c) => c.type === "TEXT");
      const key = labelKey(instance);
      if (labelLayer && key) {
        instance.properties = { ...instance.properties, [key]: labelLayer.characters ?? "" };
      }
      out.type = "INSTANCE";
      out.instance = instance;
      return out;
    }

    if (node.type === "INSTANCE") {
      const main = await node.getMainComponentAsync?.();
      const set = main?.parent?.type === "COMPONENT_SET" ? main.parent : undefined;
      const properties: Record<string, string | boolean> = {};
      for (const [key, prop] of Object.entries(node.componentProperties ?? {})) {
        properties[propertyName(key)] = prop.value;
      }
      out.instance = {
        // A standalone component has no set; its name is the component's alone.
        componentSet: set?.name,
        component: main?.name ?? "",
        properties,
      };
      return out;
    }

    const mode = node.layoutMode;
    if (mode === "HORIZONTAL" || mode === "VERTICAL" || mode === "NONE") {
      out.layout = {
        mode,
        itemSpacing: node.itemSpacing,
        padding: {
          left: node.paddingLeft,
          top: node.paddingTop,
          right: node.paddingRight,
          bottom: node.paddingBottom,
        },
        primaryAxisAlign: node.primaryAxisAlignItems as UiLayout["primaryAxisAlign"],
        counterAxisAlign: node.counterAxisAlignItems as UiLayout["counterAxisAlign"],
      };
    }
    out.fill = await readPaint(node.fills);
    if (node.strokes && node.strokes.length > 0) {
      const stroke = await readPaint(node.strokes);
      if (stroke) out.stroke = { ...stroke, weight: num(node.strokeWeight) ?? 1 };
    }
    const radius = num(node.cornerRadius);
    if (radius) out.cornerRadius = radius;
    if (node.children) out.children = await Promise.all(node.children.map(read));
    return out;
  };

  return {
    schema: SNAPSHOT_SCHEMA,
    source: { fileKey: figma.fileKey, nodeId: root.id },
    root: await read(root),
  };
}

/**
 * A resolver over components already in the file: the first component set (or
 * standalone component) whose name matches the instance's set, case-blind.
 * Pass the nodes to search — a page's `findAllWithCriteria({types:
 * ["COMPONENT_SET","COMPONENT"]})` in the plugin.
 */
export function componentsByName(candidates: readonly UiFigmaNode[]): ComponentResolver {
  const byName = new Map<string, UiFigmaNode>();
  for (const c of candidates) {
    const key = c.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, c);
  }
  return (instance) => {
    const found = byName.get((instance.componentSet ?? instance.component ?? "").toLowerCase());
    if (!found) return null;
    if (found.type === "COMPONENT_SET") return found.defaultVariant ?? null;
    return found;
  };
}
