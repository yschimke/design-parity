/** Figma-runtime enhancements for a layered SVG after `createNodeFromSvg`. */
import type {
  FigmaTextStyleSpec,
  FigmaVariableCollection,
} from "@design-parity/catalog-export/figma";

import { hexToRgba, STAMP } from "../src/scene.js";
import {
  chooseAvailableFont,
  inferAutoLayout,
  svgFontRequests,
  svgTokenAnnotations,
} from "../src/nativeSvg.js";

export interface FontPreflight {
  loaded: FontName[];
  missing: string[];
}

/** Load every locally available face requested by the SVG before Figma parses its text. */
export async function preflightSvgFonts(svg: string): Promise<FontPreflight> {
  const requests = svgFontRequests(svg);
  if (requests.length === 0) return { loaded: [], missing: [] };
  const available = (await figma.listAvailableFontsAsync()).map((font) => font.fontName);
  const picked = requests.map((request) => ({ request, font: chooseAvailableFont(request, available) }));
  const unique = new Map<string, FontName>();
  for (const { font } of picked) {
    if (font) unique.set(`${font.family}|${font.style}`, font);
  }
  await Promise.all([...unique.values()].map((font) => figma.loadFontAsync(font)));
  return {
    loaded: [...unique.values()],
    missing: [...new Set(picked.filter((item) => !item.font).map((item) => item.request.family))],
  };
}

function fullBackground(group: GroupNode): RectangleNode | undefined {
  return group.children.find((child): child is RectangleNode =>
    child.type === "RECTANGLE" &&
    Math.abs(child.x) <= 1 &&
    Math.abs(child.y) <= 1 &&
    Math.abs(child.width - group.width) <= 1 &&
    Math.abs(child.height - group.height) <= 1
  );
}

function copyBackground(frame: FrameNode, background: RectangleNode): void {
  frame.fills = background.fills;
  frame.strokes = background.strokes;
  frame.effects = background.effects;
  frame.opacity = background.opacity;
  if (typeof background.strokeWeight === "number") frame.strokeWeight = background.strokeWeight;
  if (typeof background.cornerRadius === "number") frame.cornerRadius = background.cornerRadius;
}

/**
 * Replace SVG groups that own a full-size background rectangle with native
 * frames. Unambiguous child rows/columns become Auto Layout with inferred
 * per-edge padding and gap; overlapping artwork stays absolute inside a frame.
 */
export function promoteNativeContainers(root: SceneNode): number {
  if (!("findAll" in root)) return 0;
  const groups = root.findAll((node) => node.type === "GROUP") as GroupNode[];
  // Children first: replacing an inner group preserves the outer group's box.
  groups.sort((a, b) => depth(b) - depth(a));
  let promoted = 0;
  for (const group of groups) {
    if (group.removed) continue;
    const background = fullBackground(group);
    if (!background) continue;
    const parent = group.parent;
    if (!parent || !("insertChild" in parent)) continue;

    const groupWidth = group.width;
    const groupHeight = group.height;
    const content = group.children.filter((child) => child !== background);
    const layout = inferAutoLayout(
      { width: groupWidth, height: groupHeight },
      content.map((child) => ({ x: child.x, y: child.y, width: child.width, height: child.height })),
    );
    const index = parent.children.indexOf(group);
    const frame = figma.createFrame();
    frame.name = group.name;
    frame.resize(groupWidth, groupHeight);
    frame.x = group.x;
    frame.y = group.y;
    frame.rotation = group.rotation;
    frame.fills = [];
    frame.clipsContent = false;
    copyBackground(frame, background);
    frame.opacity = group.opacity * background.opacity;
    frame.blendMode = group.blendMode;
    frame.effects = [...group.effects, ...background.effects];
    parent.insertChild(index, frame);

    const positions = new Map(content.map((child) => [child, { x: child.x, y: child.y }]));
    const ordered = layout ? layout.order.map((i) => content[i]!) : content;
    for (const child of ordered) {
      frame.appendChild(child);
      const position = positions.get(child)!;
      child.x = position.x;
      child.y = position.y;
    }
    background.remove();
    group.remove();

    if (layout) {
      frame.layoutMode = layout.mode;
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";
      // Enabling Auto Layout initially gives a frame Hug sizing; restore the
      // exact imported component box before applying its spacing.
      frame.resize(groupWidth, groupHeight);
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = layout.counterAxisAlignItems;
      frame.itemSpacing = layout.gap;
      frame.paddingTop = layout.paddingTop;
      frame.paddingRight = layout.paddingRight;
      frame.paddingBottom = layout.paddingBottom;
      frame.paddingLeft = layout.paddingLeft;
    }
    promoted += 1;
  }
  return promoted;
}

function depth(node: BaseNode): number {
  let n = node.parent;
  let value = 0;
  while (n) {
    value += 1;
    n = n.parent;
  }
  return value;
}

interface ImportedVariables {
  collection: VariableCollection;
  variables: Map<string, Variable>;
  modeIds: Map<string, string>;
}

function valueFor(type: VariableResolvedDataType, value: string | number): VariableValue {
  if (type === "COLOR") return hexToRgba(String(value));
  if (type === "FLOAT") return Number(value);
  if (type === "BOOLEAN") return Boolean(value);
  return String(value);
}

function scopes(type: VariableResolvedDataType, name: string): VariableScope[] {
  if (type === "COLOR") return ["ALL_FILLS", "STROKE_COLOR"];
  if (type !== "FLOAT") return ["ALL_SCOPES"];
  if (name.startsWith("radius/")) return ["CORNER_RADIUS"];
  if (name.startsWith("spacing/")) return ["GAP"];
  return ["ALL_SCOPES"];
}

/** Create or update the catalog's named local collection, rather than duplicating it per insert. */
async function ensureVariables(spec: FigmaVariableCollection): Promise<ImportedVariables> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find((item) => item.name === spec.name);
  const createdCollection = !collection;
  collection ??= figma.variables.createVariableCollection(spec.name);

  const modeIds = new Map<string, string>();
  const entries = Object.entries(spec.modes);
  if (createdCollection && entries[0]) collection.renameMode(collection.modes[0]!.modeId, entries[0][1]);
  for (const [key, name] of entries) {
    let mode = collection.modes.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!mode) {
      try {
        const modeId = collection.addMode(name);
        mode = { modeId, name };
      } catch {
        // A file-plan mode limit should not prevent inserting the component.
        mode = collection.modes[0];
      }
    }
    if (mode) modeIds.set(key, mode.modeId);
  }

  const local = await figma.variables.getLocalVariablesAsync();
  const variables = new Map<string, Variable>();
  for (const variableSpec of spec.variables) {
    let variable = local.find((item) =>
      item.variableCollectionId === collection.id &&
      item.name === variableSpec.name &&
      item.resolvedType === variableSpec.resolvedType
    );
    variable ??= figma.variables.createVariable(variableSpec.name, collection, variableSpec.resolvedType);
    variable.scopes = scopes(variableSpec.resolvedType, variableSpec.name);
    const role = variableSpec.name.split("/").slice(1).join(".");
    if (role && variableSpec.name.startsWith("color/")) {
      variable.setVariableCodeSyntax("ANDROID", `MaterialTheme.colorScheme.${role}`);
    } else if (role && variableSpec.name.startsWith("radius/")) {
      variable.setVariableCodeSyntax("ANDROID", `MaterialTheme.shapes.${role}`);
    }
    for (const [modeKey, value] of Object.entries(variableSpec.valuesByMode)) {
      const modeId = modeIds.get(modeKey) ?? collection.defaultModeId;
      variable.setValueForMode(modeId, valueFor(variableSpec.resolvedType, value));
    }
    variables.set(variableSpec.name, variable);
  }
  collection.setPluginData(STAMP, "tokens");
  return { collection, variables, modeIds };
}

function tokenWeight(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (value !== undefined && Number.isFinite(Number(value))) return Number(value);
  if (value && /bold/i.test(value)) return 700;
  if (value && /medium/i.test(value)) return 500;
  return 400;
}

/** Create/reuse local text styles and bind exact imported text metrics to them. */
export async function bindImportedTextStyles(
  root: SceneNode,
  specs: readonly FigmaTextStyleSpec[] | undefined,
): Promise<number> {
  if (!specs?.length || !("findAll" in root)) return 0;
  const available = (await figma.listAvailableFontsAsync()).map((font) => font.fontName);
  const local = await figma.getLocalTextStylesAsync();
  const styles: { spec: FigmaTextStyleSpec; style: TextStyle }[] = [];
  for (const spec of specs) {
    if (!spec.fontFamily) continue;
    const font = chooseAvailableFont({
      family: spec.fontFamily,
      weight: tokenWeight(spec.fontWeight),
      italic: /italic|oblique/i.test(spec.fontStyle ?? ""),
    }, available);
    if (!font) continue;
    await figma.loadFontAsync(font);
    let style = local.find((candidate) => candidate.name === spec.name);
    style ??= figma.createTextStyle();
    style.name = spec.name;
    style.fontName = font;
    if (spec.fontSize !== undefined) style.fontSize = spec.fontSize;
    if (spec.lineHeight !== undefined) style.lineHeight = { unit: "PIXELS", value: spec.lineHeight };
    if (spec.letterSpacing !== undefined) {
      style.letterSpacing = { unit: "PIXELS", value: spec.letterSpacing };
    }
    style.description = `Code: ${spec.androidCodeSyntax}`;
    styles.push({ spec, style });
  }

  let bound = 0;
  for (const text of root.findAll((node) => node.type === "TEXT") as TextNode[]) {
    if (text.fontName === figma.mixed || text.fontSize === figma.mixed) continue;
    const fontName = text.fontName;
    const fontSize = text.fontSize;
    const matches = styles.filter(({ spec, style }) =>
      style.fontName.family.toLowerCase() === fontName.family.toLowerCase() &&
      style.fontName.style.toLowerCase() === fontName.style.toLowerCase() &&
      (spec.fontSize === undefined || Math.abs(spec.fontSize - Number(fontSize)) <= 0.5)
    );
    if (matches.length !== 1) continue;
    await text.setTextStyleIdAsync(matches[0]!.style.id);
    bound += 1;
  }
  return bound;
}

/** Expose stable, common text layers on an imported component set as TEXT properties. */
export function exposeCommonTextProperties(set: ComponentSetNode): number {
  const variants = set.children.filter((child): child is ComponentNode => child.type === "COMPONENT");
  if (variants.length === 0) return 0;
  const maps = variants.map((variant) => {
    const byName = new Map<string, TextNode[]>();
    for (const text of variant.findAll((node) => node.type === "TEXT") as TextNode[]) {
      const bucket = byName.get(text.name) ?? [];
      bucket.push(text);
      byName.set(text.name, bucket);
    }
    return byName;
  });
  let count = 0;
  for (const [layerName, first] of maps[0]!) {
    if (first.length !== 1 || !maps.every((map) => map.get(layerName)?.length === 1)) continue;
    const texts = maps.map((map) => map.get(layerName)![0]!);
    if (!texts.every((text) => text.characters === texts[0]!.characters)) continue;
    const label = layerName.trim() && !/^text\s*\d*$/i.test(layerName) ? layerName.trim() : `Text ${count + 1}`;
    const property = set.addComponentProperty(label, "TEXT", texts[0]!.characters);
    for (const text of texts) text.componentPropertyReferences = { characters: property };
    count += 1;
  }
  return count;
}

/** Expose uniquely named text layers on one main component. */
export function exposeTextProperties(component: ComponentNode): number {
  const byName = new Map<string, TextNode[]>();
  for (const text of component.findAll((node) => node.type === "TEXT") as TextNode[]) {
    const bucket = byName.get(text.name) ?? [];
    bucket.push(text);
    byName.set(text.name, bucket);
  }
  let count = 0;
  for (const [layerName, texts] of byName) {
    if (texts.length !== 1) continue;
    const text = texts[0]!;
    const label = layerName.trim() && !/^text\s*\d*$/i.test(layerName) ? layerName.trim() : `Text ${count + 1}`;
    const property = component.addComponentProperty(label, "TEXT", text.characters);
    text.componentPropertyReferences = { characters: property };
    count += 1;
  }
  return count;
}

function rgbaKey(value: RGB | RGBA): string {
  const alpha = "a" in value ? value.a : 1;
  return [value.r, value.g, value.b, alpha].map((part) => Math.round(part * 10000)).join("/");
}

function paintKey(paint: SolidPaint): string {
  return rgbaKey({ ...paint.color, a: paint.opacity ?? 1 });
}

function walk(root: SceneNode): SceneNode[] {
  return [root, ...("findAll" in root ? root.findAll(() => true) : [])];
}

function bindPaints(node: SceneNode, color: Map<string, Variable>): number {
  let count = 0;
  for (const field of ["fills", "strokes"] as const) {
    if (!(field in node)) continue;
    const geometry = node as SceneNode & GeometryMixin;
    if (geometry[field] === figma.mixed) continue;
    const paints = geometry[field] as readonly Paint[];
    let changed = false;
    const bound = paints.map((paint) => {
      if (paint.type !== "SOLID") return paint;
      const variable = color.get(paintKey(paint));
      if (!variable) return paint;
      changed = true;
      count += 1;
      return figma.variables.setBoundVariableForPaint(paint, "color", variable);
    });
    if (changed) geometry[field] = bound;
  }
  return count;
}

/** Bind imported literal paints/radii/spacing to the named catalog variables. */
export async function bindImportedVariables(
  root: SceneNode,
  svg: string,
  spec: FigmaVariableCollection | undefined,
): Promise<number> {
  if (!spec || spec.variables.length === 0) return 0;
  const imported = await ensureVariables(spec);
  const colorCandidates = new Map<string, Variable[]>();
  const colorModes = new Map<string, string[]>();
  const floatCandidates = new Map<number, Variable[]>();
  for (const variableSpec of spec.variables) {
    const variable = imported.variables.get(variableSpec.name)!;
    for (const [modeKey, value] of Object.entries(variableSpec.valuesByMode)) {
      if (variableSpec.resolvedType === "COLOR") {
        const key = rgbaKey(hexToRgba(String(value)));
        const bucket = colorCandidates.get(key) ?? [];
        if (!bucket.includes(variable)) bucket.push(variable);
        colorCandidates.set(key, bucket);
        const modes = colorModes.get(key) ?? [];
        if (!modes.includes(modeKey)) modes.push(modeKey);
        colorModes.set(key, modes);
      } else if (variableSpec.resolvedType === "FLOAT") {
        const n = Number(value);
        const bucket = floatCandidates.get(n) ?? [];
        if (!bucket.includes(variable)) bucket.push(variable);
        floatCandidates.set(n, bucket);
      }
    }
  }
  const uniqueColors = new Map([...colorCandidates].filter(([, vars]) => vars.length === 1).map(([key, vars]) => [key, vars[0]!]));

  // Keep the imported appearance when the collection has modes: literal
  // colours that occur in only one mode identify the SVG as light/dark. Set
  // that mode explicitly before paints become variable-backed.
  const modeHits = new Map<string, number>();
  for (const node of walk(root)) {
    for (const field of ["fills", "strokes"] as const) {
      if (!(field in node)) continue;
      const geometry = node as SceneNode & GeometryMixin;
      if (geometry[field] === figma.mixed) continue;
      for (const paint of geometry[field] as readonly Paint[]) {
        if (paint.type !== "SOLID") continue;
        const modes = colorModes.get(paintKey(paint)) ?? [];
        if (modes.length === 1) modeHits.set(modes[0]!, (modeHits.get(modes[0]!) ?? 0) + 1);
      }
    }
  }
  const dominantMode = [...modeHits].sort((a, b) => b[1] - a[1])[0]?.[0];
  const dominantModeId = dominantMode ? imported.modeIds.get(dominantMode) : undefined;
  if (dominantModeId) root.setExplicitVariableModeForCollection(imported.collection, dominantModeId);

  // `data-token` resolves otherwise-ambiguous semantic colours (several theme
  // roles often share the same literal in one mode).
  const nodes = walk(root);
  const used = new Set<string>();
  let count = 0;
  for (const annotation of svgTokenAnnotations(svg)) {
    const variable = imported.variables.get(`color/${annotation.token}`) ?? imported.variables.get(annotation.token);
    if (!variable) continue;
    const node = nodes.find((item) => item.name === annotation.layer && !used.has(item.id));
    if (!node) continue;
    used.add(node.id);
    const allowed = new Map<string, Variable>();
    for (const [key, candidates] of colorCandidates) if (candidates.includes(variable)) allowed.set(key, variable);
    for (const child of walk(node)) count += bindPaints(child, allowed);
  }
  for (const node of nodes) count += bindPaints(node, uniqueColors);

  for (const node of nodes) {
    if (!("setBoundVariable" in node)) continue;
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
      const candidates = floatCandidates.get(node.cornerRadius) ?? [];
      const radius = candidates.filter((item) => item.name.startsWith("radius/"));
      if (radius.length === 1) { node.setBoundVariable("cornerRadius", radius[0]!); count += 1; }
    }
    if ("layoutMode" in node && node.layoutMode !== "NONE") {
      for (const field of ["itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const) {
        const candidates = (floatCandidates.get(node[field]) ?? []).filter((item) => item.name.startsWith("spacing/"));
        if (candidates.length === 1) { node.setBoundVariable(field, candidates[0]!); count += 1; }
      }
    }
  }
  return count;
}
