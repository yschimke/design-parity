/**
 * Main-thread plugin entry — the only realm with the `figma` scene API.
 *
 * It owns no logic: it receives a fully-resolved {@link ImportPlan} plus the
 * fetched PNG bytes from the UI iframe (the main thread has no network), then
 * lays the plan out on the canvas. Everything decision-shaped — which images,
 * which URLs, how tokens map to variables — was computed by the pure planner in
 * `src/plan.ts` and tested there. Keep this file mechanical.
 */
import type { ImportPlan, PlannedGroup } from "../src/plan.js";
import type { FigmaVariableCollection } from "@design-parity/catalog-export/figma";

/** Bytes the UI fetched for one planned image, keyed by its bundle path. */
interface FetchedImage {
  path: string;
  bytes: Uint8Array;
}

/** The message the UI posts once it has resolved the plan and all image bytes. */
interface ImportMessage {
  type: "import";
  plan: ImportPlan;
  images: FetchedImage[];
}

type UiMessage = ImportMessage | { type: "cancel" };

const PAD = 48;
const GAP = 24;
const GROUP_GAP = 64;

figma.showUI(__html__, { width: 420, height: 320, themeColors: true });

figma.ui.onmessage = async (msg: UiMessage): Promise<void> => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "import") {
    try {
      const summary = await runImport(msg.plan, msg.images);
      figma.ui.postMessage({ type: "done", summary });
      figma.notify(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "error", message });
      figma.notify(`Import failed: ${message}`, { error: true });
    }
  }
};

async function runImport(
  plan: ImportPlan,
  images: FetchedImage[],
): Promise<string> {
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
  root.appendChild(title(plan.title, 32));

  let placed = 0;
  for (const group of plan.groups) {
    root.appendChild(renderGroup(group, bytesByPath, () => (placed += 1)));
  }

  let variableNote = "";
  if (plan.collection) {
    const n = createVariableCollection(plan.collection);
    variableNote = `, ${n} variables`;
  }

  figma.viewport.scrollAndZoomIntoView([root]);
  return `Imported ${placed} render${placed === 1 ? "" : ""} across ${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}${variableNote}.`;
}

function renderGroup(
  group: PlannedGroup,
  bytesByPath: Map<string, Uint8Array>,
  onPlaced: () => void,
): FrameNode {
  const section = figma.createFrame();
  section.name = group.name;
  section.layoutMode = "VERTICAL";
  section.itemSpacing = GAP;
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.fills = [];
  section.appendChild(title(group.name, 20));

  for (const component of group.components) {
    const row = figma.createFrame();
    row.name = component.componentId;
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = GAP;
    row.primaryAxisSizingMode = "AUTO";
    row.counterAxisSizingMode = "AUTO";
    row.fills = [];

    for (const image of component.images) {
      const bytes = bytesByPath.get(image.path);
      if (!bytes) continue;
      const node = figma.createRectangle();
      node.name = `${component.componentId} — ${image.key}`;
      node.resize(image.width, image.height);
      const hash = figma.createImage(bytes).hash;
      node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
      row.appendChild(node);
      onPlaced();
    }
    section.appendChild(row);
  }
  return section;
}

function createVariableCollection(spec: FigmaVariableCollection): number {
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

function coerce(
  type: FigmaVariableCollection["variables"][number]["resolvedType"],
  value: string | number,
): VariableValue {
  if (type === "COLOR") return hexToRgba(String(value));
  if (type === "FLOAT") return Number(value);
  if (type === "BOOLEAN") return Boolean(value);
  return String(value);
}

function hexToRgba(input: string): RGBA {
  const hex = input.replace(/^#/, "").trim();
  const full =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function title(text: string, size: number): TextNode {
  const node = figma.createText();
  node.fontName = { family: "Inter", style: "Semi Bold" };
  node.fontSize = size;
  node.characters = text;
  return node;
}
