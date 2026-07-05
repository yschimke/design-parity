/**
 * The main-thread scene builder — the plugin logic that turns an
 * {@link ImportPlan} + fetched PNG bytes into a Figma canvas.
 *
 * It takes the Figma scene API as an **injected** {@link FigmaApi} parameter
 * rather than reaching for the `figma` global, so it runs — and is asserted —
 * headlessly in tests against a fake API (`test/fakeFigma.ts`), catching scene
 * mistakes (wrong calls, ordering, null handling) before the plugin ever loads
 * in real Figma. `figma/code.ts` is the thin bootstrap that passes the real
 * `figma` in. Only genuinely runtime-specific behaviour (font metrics, image
 * decoding) is left to the manual smoke test.
 *
 * `FigmaApi` is a hand-written structural subset of Figma's `PluginAPI` — just
 * the members this builder uses. The real `figma` satisfies it (the bootstrap
 * bridges with one cast); the fake implements it exactly.
 */
import type { FigmaVariableCollection, FigmaVariableType } from "@design-parity/catalog-export/figma";

import { redlineLabel, redlineRgb, severityRgb } from "./annotations.js";
import { buildDesignMap } from "./designMap.js";
import type { ImportPlan, PlannedGroup } from "./plan.js";
import type { DesignMap } from "@design-parity/core";

const PAD = 48;
const GAP = 24;
const GROUP_GAP = 64;

/** A colour or scalar assigned to a Figma variable, per mode. */
export interface FigmaRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export type FigmaVariableValue = FigmaRgba | number | string | boolean;

/** A paint the builder assigns to a node's `fills` / `strokes`. */
export type FigmaPaint =
  | { type: "SOLID"; color: { r: number; g: number; b: number } }
  | { type: "IMAGE"; scaleMode: "FILL"; imageHash: string };

/**
 * One scene node. A single permissive shape stands in for frame / rectangle /
 * text nodes — each uses a subset of these members, mirroring how the real
 * typed nodes structurally provide them.
 */
export interface FigmaNode {
  id: string;
  name: string;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  dashPattern?: number[];
  cornerRadius?: number;
  x?: number;
  y?: number;
  fontName?: { family: string; style: string };
  fontSize?: number;
  characters?: string;
  appendChild(child: FigmaNode): void;
  resize(width: number, height: number): void;
}

export interface FigmaVariableCollectionNode {
  modes: { modeId: string }[];
  defaultModeId: string;
  renameMode(modeId: string, name: string): void;
  addMode(name: string): string;
}

export interface FigmaVariableNode {
  setValueForMode(modeId: string, value: FigmaVariableValue): void;
}

/** The subset of Figma's `PluginAPI` the scene builder depends on. */
export interface FigmaApi {
  fileKey?: string;
  currentPage: FigmaNode;
  loadFontAsync(font: { family: string; style: string }): Promise<void>;
  createPage(): FigmaNode;
  createFrame(): FigmaNode;
  createRectangle(): FigmaNode;
  createText(): FigmaNode;
  createImage(bytes: Uint8Array): { hash: string };
  variables: {
    createVariableCollection(name: string): FigmaVariableCollectionNode;
    createVariable(
      name: string,
      collection: FigmaVariableCollectionNode,
      type: FigmaVariableType,
    ): FigmaVariableNode;
  };
  viewport: { scrollAndZoomIntoView(nodes: FigmaNode[]): void };
}

/** Bytes the UI fetched for one planned image, keyed by its bundle path. */
export interface FetchedImage {
  path: string;
  bytes: Uint8Array;
}

/** The outcome of an import: a human summary plus the correspondence to export. */
export interface ImportResult {
  summary: string;
  designMap: DesignMap;
  fileKeyKnown: boolean;
}

/**
 * Build the catalog page for a plan + image bytes (pure given the injected
 * {@link FigmaApi}). Returns the summary line and the emitted `design-map.json`.
 */
export async function applyImport(
  figma: FigmaApi,
  plan: ImportPlan,
  images: FetchedImage[],
): Promise<ImportResult> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const bytesByPath = new Map(images.map((i) => [i.path, i.bytes]));

  const page = figma.createPage();
  page.name = `${plan.title} — Catalog`;
  figma.currentPage = page;

  const root = figma.createFrame();
  root.name = plan.title;
  root.layoutMode = "VERTICAL";
  root.itemSpacing = GROUP_GAP;
  root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = PAD;
  root.primaryAxisSizingMode = "AUTO";
  root.counterAxisSizingMode = "AUTO";
  root.appendChild(title(figma, plan.title, 32));

  let placed = 0;
  // componentId → the frame the plugin placed, for correspondence authoring.
  const nodeIds: Record<string, string> = {};
  for (const group of plan.groups) {
    root.appendChild(renderGroup(figma, group, bytesByPath, nodeIds, () => (placed += 1)));
  }

  let variableNote = "";
  if (plan.collection) {
    const n = createVariableCollection(figma, plan.collection);
    variableNote = `, ${n} variables`;
  }

  figma.viewport.scrollAndZoomIntoView([root]);

  // Emit the design-map correspondence (code componentId → placed frame). The
  // file key is null outside a saved file — fall back to a placeholder the user
  // fills in, rather than emitting an unparseable empty ref.
  const fileKey = figma.fileKey ?? "";
  const designMap = buildDesignMap(plan, { fileKey: fileKey || "FILE_KEY", nodeIds });

  const groupNote = `${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}`;
  const greenlineNote =
    plan.greenlineCount > 0 ? `, ${plan.greenlineCount} a11y greenlines` : "";
  const redlineNote =
    plan.redlineCount > 0 ? `, ${plan.redlineCount} layout redlines` : "";
  const summary = `Imported ${placed} render${placed === 1 ? "" : "s"} across ${groupNote}${greenlineNote}${redlineNote}${variableNote}.`;
  return { summary, designMap, fileKeyKnown: fileKey.length > 0 };
}

function renderGroup(
  figma: FigmaApi,
  group: PlannedGroup,
  bytesByPath: Map<string, Uint8Array>,
  nodeIds: Record<string, string>,
  onPlaced: () => void,
): FigmaNode {
  const section = figma.createFrame();
  section.name = group.name;
  section.layoutMode = "VERTICAL";
  section.itemSpacing = GAP;
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.fills = [];
  section.appendChild(title(figma, group.name, 20));

  for (const component of group.components) {
    const row = figma.createFrame();
    row.name = component.componentId;
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = GAP;
    row.primaryAxisSizingMode = "AUTO";
    row.counterAxisSizingMode = "AUTO";
    row.fills = [];

    let componentPlaced = false;
    component.images.forEach((image, i) => {
      const bytes = bytesByPath.get(image.path);
      if (!bytes) return;
      componentPlaced = true;
      const hash = figma.createImage(bytes).hash;

      // A fixed-size frame holds the render plus, on the first image, the a11y
      // greenline overlay positioned in the render's own pixel space.
      const cell = figma.createFrame();
      cell.name = `${component.componentId} — ${image.key}`;
      cell.resize(image.width, image.height);
      cell.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];

      if (i === 0) {
        for (const g of component.greenlines) {
          if (!g.bounds) continue;
          const box = figma.createRectangle();
          box.name = `a11y (${g.severity}): ${g.message}`;
          box.x = g.bounds.x;
          box.y = g.bounds.y;
          box.resize(Math.max(1, g.bounds.width), Math.max(1, g.bounds.height));
          box.fills = [];
          box.strokes = [{ type: "SOLID", color: severityRgb(g.severity) }];
          box.strokeWeight = 2;
          cell.appendChild(box);
        }
        for (const r of component.redlines) {
          const label = redlineLabel(r);
          const box = figma.createRectangle();
          box.name = `layout: ${label || r.role || "node"}`;
          box.x = r.bounds.x;
          box.y = r.bounds.y;
          box.resize(Math.max(1, r.bounds.width), Math.max(1, r.bounds.height));
          box.fills = [];
          box.strokes = [{ type: "SOLID", color: redlineRgb() }];
          box.strokeWeight = 1;
          box.dashPattern = [4, 3];
          if (r.cornerRadius !== undefined) box.cornerRadius = r.cornerRadius;
          cell.appendChild(box);
          if (label) {
            const tag = figma.createText();
            tag.fontName = { family: "Inter", style: "Regular" };
            tag.fontSize = 9;
            tag.characters = label;
            tag.x = r.bounds.x + 2;
            tag.y = r.bounds.y + 2;
            tag.fills = [{ type: "SOLID", color: redlineRgb() }];
            cell.appendChild(tag);
          }
        }
      }
      row.appendChild(cell);
      onPlaced();
    });
    // Only map components that actually placed a render — the row frame is the
    // node correspondence links back to.
    if (componentPlaced) nodeIds[component.componentId] = row.id;
    section.appendChild(row);
  }
  return section;
}

function createVariableCollection(
  figma: FigmaApi,
  spec: FigmaVariableCollection,
): number {
  const collection = figma.variables.createVariableCollection(spec.name);
  // Rename the auto-created first mode; add the rest.
  const modeEntries = Object.entries(spec.modes);
  const modeIds = new Map<string, string>();
  const [firstId, firstName] = modeEntries[0] ?? [spec.defaultModeId, "Value"];
  collection.renameMode(collection.modes[0]!.modeId, firstName);
  modeIds.set(firstId, collection.modes[0]!.modeId);
  for (const [id, name] of modeEntries.slice(1)) {
    modeIds.set(id, collection.addMode(name));
  }

  for (const variable of spec.variables) {
    const created = figma.variables.createVariable(
      variable.name,
      collection,
      variable.resolvedType,
    );
    for (const [modeKey, value] of Object.entries(variable.valuesByMode)) {
      const modeId = modeIds.get(modeKey) ?? collection.defaultModeId;
      created.setValueForMode(modeId, coerce(variable.resolvedType, value));
    }
  }
  return spec.variables.length;
}

function coerce(type: FigmaVariableType, value: string | number): FigmaVariableValue {
  if (type === "COLOR") return hexToRgba(String(value));
  if (type === "FLOAT") return Number(value);
  if (type === "BOOLEAN") return Boolean(value);
  return String(value);
}

/** `#rrggbb`(`aa`) → Figma 0–1 RGBA. Exported for the bootstrap's paint coercion. */
export function hexToRgba(input: string): FigmaRgba {
  const hex = input.replace(/^#/, "").trim();
  const full =
    hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function title(figma: FigmaApi, text: string, size: number): FigmaNode {
  const node = figma.createText();
  node.fontName = { family: "Inter", style: "Semi Bold" };
  node.fontSize = size;
  node.characters = text;
  return node;
}
