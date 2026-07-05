/**
 * A fake of the {@link FigmaApi} subset the scene builder uses, so `applyImport`
 * runs headlessly under vitest. It records every created node (with parent/child
 * links), image, variable collection, loaded font, and viewport call, so a test
 * can assert the exact scene the plugin would build in real Figma.
 */
import type { FigmaVariableType } from "@design-parity/catalog-export/figma";

import type {
  FigmaApi,
  FigmaNode,
  FigmaVariableCollectionNode,
  FigmaVariableValue,
} from "../src/scene.js";

export interface FakeNode extends FigmaNode {
  kind: "frame" | "rect" | "text" | "page" | "component" | "component-set";
  children: FakeNode[];
  parent?: FakeNode;
  width?: number;
  height?: number;
}

export interface FakeVariable {
  name: string;
  type: FigmaVariableType;
  values: Record<string, FigmaVariableValue>;
}

export interface FakeCollection {
  name: string;
  modes: { modeId: string; name?: string }[];
  defaultModeId: string;
  variables: FakeVariable[];
}

export interface FakeFigmaState {
  nodes: FakeNode[];
  images: { hash: string; bytes: Uint8Array }[];
  collections: FakeCollection[];
  scrolledInto: FakeNode[][];
  fontsLoaded: { family: string; style: string }[];
}

export interface FakeFigma {
  figma: FigmaApi;
  state: FakeFigmaState;
  /** The one root frame the plugin creates (auto-parented to the page in Figma). */
  root(): FakeNode;
}

export function createFakeFigma(opts: { fileKey?: string } = {}): FakeFigma {
  let idc = 0;
  const state: FakeFigmaState = {
    nodes: [],
    images: [],
    collections: [],
    scrolledInto: [],
    fontsLoaded: [],
  };
  const collectionByApi = new Map<FigmaVariableCollectionNode, FakeCollection>();

  const pages: FakeNode[] = [];

  function make(kind: FakeNode["kind"]): FakeNode {
    const pluginData: Record<string, Record<string, string>> = {};
    const n: FakeNode = {
      kind,
      id: `${idc++}:0`,
      name: "",
      children: [],
      appendChild(child: FigmaNode): void {
        const c = child as FakeNode;
        // Reparent: drop from a previous parent so the tree stays a tree.
        if (c.parent) {
          c.parent.children = c.parent.children.filter((x) => x !== c);
        }
        c.parent = n;
        n.children.push(c);
      },
      resize(width: number, height: number): void {
        n.width = width;
        n.height = height;
      },
      setSharedPluginData(namespace: string, key: string, value: string): void {
        (pluginData[namespace] ??= {})[key] = value;
      },
      getSharedPluginData(namespace: string, key: string): string {
        return pluginData[namespace]?.[key] ?? "";
      },
    };
    state.nodes.push(n);
    if (kind === "page") pages.push(n);
    return n;
  }

  const figma: FigmaApi = {
    fileKey: opts.fileKey,
    root: { get children(): readonly FigmaNode[] { return pages; } },
    currentPage: undefined as unknown as FigmaNode,
    async loadFontAsync(font: { family: string; style: string }): Promise<void> {
      state.fontsLoaded.push(font);
    },
    createPage: () => make("page"),
    createFrame: () => make("frame"),
    createRectangle: () => make("rect"),
    createText: () => make("text"),
    createComponent: () => make("component"),
    combineAsVariants(components: FigmaNode[], parent: FigmaNode): FigmaNode {
      const set = make("component-set");
      for (const component of components) set.appendChild(component); // reparents into the set
      parent.appendChild(set);
      return set;
    },
    createImage(bytes: Uint8Array): { hash: string } {
      const hash = `img${state.images.length}`;
      state.images.push({ hash, bytes });
      return { hash };
    },
    variables: {
      createVariableCollection(name: string): FigmaVariableCollectionNode {
        const col: FakeCollection = {
          name,
          modes: [{ modeId: "mode0" }],
          defaultModeId: "mode0",
          variables: [],
        };
        state.collections.push(col);
        const api: FigmaVariableCollectionNode = {
          modes: col.modes,
          defaultModeId: col.defaultModeId,
          renameMode(modeId: string, nm: string): void {
            const m = col.modes.find((x) => x.modeId === modeId);
            if (m) m.name = nm;
          },
          addMode(nm: string): string {
            const modeId = `mode${col.modes.length}`;
            col.modes.push({ modeId, name: nm });
            return modeId;
          },
        };
        collectionByApi.set(api, col);
        return api;
      },
      createVariable(name, collection, type) {
        const col = collectionByApi.get(collection)!;
        const v: FakeVariable = { name, type, values: {} };
        col.variables.push(v);
        return {
          setValueForMode(modeId: string, value: FigmaVariableValue): void {
            v.values[modeId] = value;
          },
        };
      },
    },
    viewport: {
      scrollAndZoomIntoView(nodes: FigmaNode[]): void {
        state.scrolledInto.push(nodes as FakeNode[]);
      },
    },
  };

  return {
    figma,
    state,
    root(): FakeNode {
      // The catalog root is the frame stamped `role=catalog-root`. A re-import
      // reconciles into the same one, so there is still exactly one.
      const roots = state.nodes.filter(
        (n) => n.kind === "frame" && n.getSharedPluginData("designParity", "role") === "catalog-root",
      );
      if (roots.length !== 1) {
        throw new Error(`expected exactly one catalog-root frame, found ${roots.length}`);
      }
      return roots[0]!;
    },
  };
}

/** Recursively collect nodes matching a predicate (depth-first). */
export function descendants(node: FakeNode, pred: (n: FakeNode) => boolean): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode): void => {
    if (pred(n)) out.push(n);
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return out;
}
