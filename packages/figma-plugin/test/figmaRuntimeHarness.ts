/**
 * A focused, deterministic model of the Figma Plugin API used by runtime tests.
 *
 * This deliberately models observable scene semantics rather than pretending to
 * emulate the whole editor. Keep additions driven by production API calls and
 * retain the small real-host check documented in the README for Figma-owned
 * behavior such as SVG parsing and local font availability.
 */

export interface RuntimeCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
  pluginData: Record<string, string>;
  renameMode(modeId: string, name: string): void;
  addMode(name: string): string;
  setPluginData(key: string, value: string): void;
}

export interface RuntimeVariable {
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

export interface RuntimeTextStyle {
  id: string;
  name: string;
  fontName: FontName;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  description: string;
}

export interface RuntimeNode {
  id: string;
  type: string;
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
  pluginData: Record<string, Record<string, string>>;
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
  setSharedPluginData(namespace: string, key: string, value: string): void;
  getSharedPluginData(namespace: string, key: string): string;
  getInstancesAsync(): Promise<RuntimeNode[]>;
}

export interface RuntimeState {
  collections: RuntimeCollection[];
  variables: RuntimeVariable[];
  textStyles: RuntimeTextStyle[];
  loadedFonts: FontName[];
  scrolledInto: RuntimeNode[][];
}

let nextId = 0;

export function resetRuntimeIds(): void {
  nextId = 0;
}

export function runtimeNode(type: string, values: Partial<RuntimeNode> = {}): RuntimeNode {
  const result: RuntimeNode = {
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
    pluginData: {},
    boundVariables: {},
    explicitModes: {},
    appendChild(child): void {
      detachRuntimeNode(child);
      child.parent = result;
      result.children.push(child);
    },
    insertChild(index, child): void {
      detachRuntimeNode(child);
      child.parent = result;
      result.children.splice(index, 0, child);
    },
    resize(width, height): void {
      result.width = width;
      result.height = height;
    },
    remove(): void {
      detachRuntimeNode(result);
      result.removed = true;
    },
    findAll(predicate): RuntimeNode[] {
      const found: RuntimeNode[] = [];
      const visit = (candidate: RuntimeNode): void => {
        if (predicate(candidate)) found.push(candidate);
        candidate.children.forEach(visit);
      };
      result.children.forEach(visit);
      return found;
    },
    setBoundVariable(field, variable): void {
      result.boundVariables[field] = variable;
    },
    setExplicitVariableModeForCollection(collection, modeId): void {
      result.explicitModes[collection.id] = modeId;
    },
    async setTextStyleIdAsync(id): Promise<void> {
      result.textStyleId = id;
    },
    setSharedPluginData(namespace, key, value): void {
      (result.pluginData[namespace] ??= {})[key] = value;
    },
    getSharedPluginData(namespace, key): string {
      return result.pluginData[namespace]?.[key] ?? "";
    },
    async getInstancesAsync(): Promise<RuntimeNode[]> {
      return [];
    },
    ...values,
  };
  return result;
}

export function appendRuntimeNodes(parent: RuntimeNode, ...children: RuntimeNode[]): RuntimeNode {
  children.forEach((child) => parent.appendChild(child));
  return parent;
}

export function detachRuntimeNode(child: RuntimeNode): void {
  if (!child.parent) return;
  child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
  child.parent = undefined;
}

export function installFigmaRuntime(fonts: FontName[] = []): RuntimeState {
  const state: RuntimeState = {
    collections: [],
    variables: [],
    textStyles: [],
    loadedFonts: [],
    scrolledInto: [],
  };
  globalThis.figma = {
    createFrame: () => runtimeNode("FRAME"),
    createRectangle: () => runtimeNode("RECTANGLE"),
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
          renameMode(modeId, modeName): void {
            const mode = collection.modes.find((candidate) => candidate.modeId === modeId);
            if (mode) mode.name = modeName;
          },
          addMode(modeName): string {
            const modeId = `mode-${collection.modes.length}`;
            collection.modes.push({ modeId, name: modeName });
            return modeId;
          },
          setPluginData(key, value): void {
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
          setValueForMode(modeId, value): void { variable.values[modeId] = value; },
          setVariableCodeSyntax(platform, syntax): void { variable.codeSyntax[platform] = syntax; },
        };
        state.variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint: (paint: SolidPaint, _field: string, variable: RuntimeVariable) => ({
        ...paint,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
      }),
    },
    viewport: {
      scrollAndZoomIntoView: (nodes: RuntimeNode[]) => { state.scrolledInto.push(nodes); },
    },
  } as unknown as PluginAPI;
  return state;
}

type ContractNode = {
  type?: unknown;
  kind?: unknown;
  name?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  cornerRadius?: unknown;
  opacity?: unknown;
  layoutMode?: unknown;
  primaryAxisSizingMode?: unknown;
  counterAxisSizingMode?: unknown;
  primaryAxisAlignItems?: unknown;
  counterAxisAlignItems?: unknown;
  itemSpacing?: unknown;
  paddingTop?: unknown;
  paddingRight?: unknown;
  paddingBottom?: unknown;
  paddingLeft?: unknown;
  fills?: unknown;
  strokes?: unknown;
  effects?: unknown;
  pluginData?: unknown;
  children?: ContractNode[];
};

/** A stable projection for scene contract snapshots; runtime-only ids are omitted. */
export function sceneContract(node: ContractNode): Record<string, unknown> {
  const contract: Record<string, unknown> = {
    type: node.type ?? node.kind,
    name: node.name,
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    size: { width: node.width ?? 0, height: node.height ?? 0 },
  };
  if (node.rotation) contract.rotation = node.rotation;
  if (node.cornerRadius) contract.cornerRadius = node.cornerRadius;
  if (node.opacity !== undefined && node.opacity !== 1) contract.opacity = node.opacity;
  if (node.layoutMode && node.layoutMode !== "NONE") {
    contract.autoLayout = {
      mode: node.layoutMode,
      sizing: [node.primaryAxisSizingMode, node.counterAxisSizingMode],
      align: [node.primaryAxisAlignItems, node.counterAxisAlignItems],
      gap: node.itemSpacing ?? 0,
      padding: [node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0],
    };
  }
  if (Array.isArray(node.fills) && node.fills.length > 0) contract.fills = node.fills;
  if (Array.isArray(node.strokes) && node.strokes.length > 0) contract.strokes = node.strokes;
  if (Array.isArray(node.effects) && node.effects.length > 0) contract.effects = node.effects;
  if (node.pluginData && Object.keys(node.pluginData as object).length > 0) contract.pluginData = node.pluginData;
  contract.children = (node.children ?? []).map(sceneContract);
  return contract;
}
