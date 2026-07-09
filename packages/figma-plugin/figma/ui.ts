/**
 * UI-iframe entry — the only realm with `fetch` / DOM.
 *
 * Two flows, one per tab:
 *  - **Catalog import**: fetch a published `catalog.json` (+ optional DTCG
 *    tokens), run the pure {@link buildImportPlan} planner, fetch every image's
 *    bytes, and post the plan + bytes to the main thread (which owns the scene).
 *  - **Override editor**: fetch a system's previews from `compose-preview serve`
 *    (`/api/previews`, v2), render each knob + display-axis as a control, and on
 *    place turn the edited state into a {@link renderSourceForPreview} render
 *    request, fetch its live PNG, and post it for {@link placeLiveRender}.
 *
 * All decisions live in the pure core (`plan.ts`, `previews.ts`, `editor.ts`,
 * `render.ts`); this file is fetch + DOM reflection + postMessage.
 */
import type { CatalogManifest } from "@design-parity/catalog-export";

import {
  componentSetCells,
  groupComponents,
  indexCatalog,
  selectCatalogImage,
  selectCatalogWireframe,
  type CatalogIndex,
  type PickComponent,
  type PickSelection,
} from "../src/catalogPick.js";
import {
  dehydrateRegistry,
  hydrateRegistry,
  registerCatalog,
  removeCatalog,
  selectCatalog,
  selectedCatalog,
  type CatalogRegistry,
  type StoredRegistry,
} from "../src/catalogs.js";
import { resolveDirection, type ParityDirection } from "../src/direction.js";
import { readDtcgTokensLite } from "../src/dtcg.js";
import {
  buildFrameSpec,
  defaultComponentId,
  specToIssueBody,
  specToJson,
  suggestKind,
  type FrameRead,
  type SpecKind,
} from "../src/spec.js";
import { EDITOR_AXES, knobControls } from "../src/editor.js";
import { buildImportPlan, type ImportPlan, type PlannedImage } from "../src/plan.js";
import {
  parsePreviewsResponse,
  previewsUrl,
  renderSourceForPreview,
  type Preview,
} from "../src/previews.js";
import { buildRenderUrl } from "../src/render.js";
import { buildSlotsUrl, parseSlotsResponse } from "../src/slots.js";
import { slotSizeAxes } from "../src/structure.js";

const form = document.getElementById("form") as HTMLFormElement;
const catalogSelect = document.getElementById("catalog") as HTMLSelectElement;
const toggleRegisterButton = document.getElementById("toggle-register") as HTMLButtonElement;
const removeCatalogButton = document.getElementById("remove-catalog") as HTMLButtonElement;
const registerPanel = document.getElementById("register") as HTMLElement;
const regLabelInput = document.getElementById("reg-label") as HTMLInputElement;
const regUrlInput = document.getElementById("reg-url") as HTMLInputElement;
const regAddButton = document.getElementById("reg-add") as HTMLButtonElement;
const regCancelButton = document.getElementById("reg-cancel") as HTMLButtonElement;
const variantInput = document.getElementById("variant") as HTMLSelectElement;
const modeInput = document.getElementById("mode") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const cancel = document.getElementById("cancel") as HTMLButtonElement;
const confirmButton = document.getElementById("confirm") as HTMLButtonElement;
const result = document.getElementById("result") as HTMLElement;
const designMapArea = document.getElementById("designmap") as HTMLTextAreaElement;
const copyButton = document.getElementById("copy") as HTMLButtonElement;

// Single-component picker controls.
const catalogPickSection = document.getElementById("catalog-pick") as HTMLElement;
const catalogBulkSection = document.getElementById("catalog-bulk") as HTMLElement;
const pickSearchInput = document.getElementById("pick-search") as HTMLInputElement;
const componentSelect = document.getElementById("pick-component") as HTMLSelectElement;
const pickCaption = document.getElementById("pick-caption") as HTMLParagraphElement;
const pickVariantField = document.getElementById("pick-variant-field") as HTMLElement;
const pickVariant = document.getElementById("pick-variant") as HTMLSelectElement;
const pickDimensions = document.getElementById("pick-dimensions") as HTMLElement;
const pickFormat = document.getElementById("pick-format") as HTMLSelectElement;
const insertButton = document.getElementById("insert") as HTMLButtonElement;
const insertSetButton = document.getElementById("insert-set") as HTMLButtonElement;
const importAllButton = document.getElementById("import-all") as HTMLButtonElement;

/** The catalog registry (built-ins + custom + last pick). Seeded on startup from
 *  clientStorage; re-persisted on every change. Starts from the code defaults so
 *  the dropdown is usable even before the main thread's stored blob arrives. */
let registry: CatalogRegistry = hydrateRegistry(undefined);

/** The last resolved import, retained so a design-led confirm can re-send it. */
let pending: { plan: ImportPlan; images: { path: string; bytes: Uint8Array }[]; direction: ParityDirection } | undefined;

/** The loaded catalog: the base URL, its manifest + tokens, and the picker index. */
let catalog:
  | {
      base: string;
      manifest: CatalogManifest;
      themeTokens?: ReturnType<typeof readDtcgTokensLite>;
      index: CatalogIndex;
    }
  | undefined;

function say(text: string): void {
  status.textContent = text;
}

function post(
  plan: ImportPlan,
  images: { path: string; bytes: Uint8Array }[],
  direction: ParityDirection,
  confirm: boolean,
): void {
  parent.postMessage({ pluginMessage: { type: "import", plan, images, direction, confirm } }, "*");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

// ── Catalog registry ────────────────────────────────────────────────────────

/** Persist the registry (custom entries + last pick) via the main thread. */
function persistRegistry(): void {
  const stored: StoredRegistry = dehydrateRegistry(registry);
  parent.postMessage({ pluginMessage: { type: "saveRegistry", stored } }, "*");
}

/** Re-fill the catalog dropdown from the registry and reflect the remembered pick. */
function renderCatalogOptions(): void {
  catalogSelect.replaceChildren();
  for (const source of registry.catalogs) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.builtin ? source.label : `${source.label} (custom)`;
    catalogSelect.append(option);
  }
  if (registry.lastSelectedId) catalogSelect.value = registry.lastSelectedId;
  // Only custom catalogs can be removed.
  removeCatalogButton.hidden = !selectedCatalog(registry) || !!selectedCatalog(registry)?.builtin;
}

catalogSelect.addEventListener("change", () => {
  registry = selectCatalog(registry, catalogSelect.value);
  removeCatalogButton.hidden = !!selectedCatalog(registry)?.builtin;
  persistRegistry();
});

toggleRegisterButton.addEventListener("click", () => {
  registerPanel.hidden = !registerPanel.hidden;
  if (!registerPanel.hidden) regLabelInput.focus();
});

regCancelButton.addEventListener("click", () => {
  registerPanel.hidden = true;
  regLabelInput.value = "";
  regUrlInput.value = "";
});

regAddButton.addEventListener("click", () => {
  try {
    registry = registerCatalog(registry, { label: regLabelInput.value, baseUrl: regUrlInput.value });
    renderCatalogOptions();
    persistRegistry();
    registerPanel.hidden = true;
    regLabelInput.value = "";
    regUrlInput.value = "";
    say(`Registered “${selectedCatalog(registry)?.label}”. Load it to browse its components.`);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

removeCatalogButton.addEventListener("click", () => {
  const current = selectedCatalog(registry);
  if (!current || current.builtin) return;
  registry = removeCatalog(registry, current.id);
  renderCatalogOptions();
  persistRegistry();
  say(`Removed “${current.label}”.`);
});

// Ask the main thread for the persisted registry; it replies with a `registry`
// message handled in `window.onmessage`. Render the code defaults immediately so
// the dropdown works before that round-trip completes.
renderCatalogOptions();
parent.postMessage({ pluginMessage: { type: "requestRegistry" } }, "*");

// Step 1 — Load: fetch the selected catalog (+ tokens) and reveal the pickers.
// Nothing is placed yet; the designer then inserts one component or the whole sheet.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const source = selectedCatalog(registry);
  if (!source) {
    say("Pick a catalog to load.");
    return;
  }
  const base = source.baseUrl.replace(/\/+$/, "");

  try {
    say("Fetching catalog.json…");
    const manifest = await fetchJson<CatalogManifest>(`${base}/catalog.json`);

    let themeTokens;
    if (manifest.tokensFile) {
      say("Fetching design tokens…");
      const doc = await fetchJson<unknown>(`${base}/${manifest.tokensFile}`);
      themeTokens = readDtcgTokensLite(doc);
    }

    const index = indexCatalog(manifest);
    if (index.components.length === 0) {
      say("Catalog has no importable renders.");
      catalogPickSection.hidden = true;
      catalogBulkSection.hidden = true;
      return;
    }

    catalog = { base, manifest, themeTokens, index };
    populateComponents(index);
    confirmButton.hidden = true;
    result.hidden = true;
    catalogPickSection.hidden = false;
    catalogBulkSection.hidden = false;
    say(`Loaded ${index.title} — ${index.components.length} component${index.components.length === 1 ? "" : "s"}. Pick one to insert, or import the whole catalog.`);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

// Step 2a — Insert one component: resolve the picked variant + dimensions to a
// single render (PNG) or the wireframe (SVG), fetch it, and post it to place.
insertButton.addEventListener("click", async () => {
  if (!catalog) return;
  const component = selectedComponent();
  if (!component) return;

  const selection: PickSelection = {
    componentId: component.componentId,
    dimensions: collectDimensions(),
  };
  if (component.variant && pickVariant.value) selection.variant = pickVariant.value;

  const name = insertName(component, selection);
  try {
    if (pickFormat.value === "svg") {
      const url = selectCatalogWireframe(catalog.manifest, component.componentId, catalog.base);
      if (!url) {
        say("This component has no wireframe SVG — insert it as PNG instead.");
        return;
      }
      say(`Fetching ${name} (SVG)…`);
      const svg = await fetchText(url);
      parent.postMessage(
        { pluginMessage: { type: "insertSvg", svg, name, componentId: component.componentId } },
        "*",
      );
    } else {
      const picked = selectCatalogImage(catalog.manifest, selection, catalog.base);
      if (!picked) {
        say("No render matches that combination — adjust the variant or dimensions.");
        return;
      }
      say(`Fetching ${name}…`);
      const bytes = await fetchBytes(picked.url);
      parent.postMessage(
        {
          pluginMessage: {
            type: "insertPng",
            bytes,
            name,
            componentId: component.componentId,
            size: { width: picked.image.width, height: picked.image.height },
          },
        },
        "*",
      );
    }
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

// Step 2a′ — Insert every variant of the picked component as one native Figma
// component set (the reusable library form). Ignores the variant/dimension
// narrowing — the set carries all of the component's ideal renders.
insertSetButton.addEventListener("click", async () => {
  if (!catalog) return;
  const component = selectedComponent();
  if (!component) return;

  const cells = componentSetCells(catalog.manifest, component.componentId, catalog.base);
  if (cells.length === 0) {
    say("This component has no renders to place.");
    return;
  }

  try {
    const fetched: { name: string; bytes: Uint8Array; width: number; height: number }[] = [];
    let done = 0;
    for (const cell of cells) {
      say(`Fetching ${component.componentId} variants… ${++done}/${cells.length}`);
      fetched.push({ name: cell.name, bytes: await fetchBytes(cell.url), width: cell.width, height: cell.height });
    }
    parent.postMessage(
      {
        pluginMessage: {
          type: "insertComponentSet",
          componentId: component.componentId,
          name: component.componentId,
          cells: fetched,
        },
      },
      "*",
    );
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

// Step 2b — Import the whole catalog: the original sticker-sheet flow, now run
// from the already-loaded manifest (the reconcile / design-map path).
importAllButton.addEventListener("click", () => void importWholeCatalog());

async function importWholeCatalog(): Promise<void> {
  if (!catalog) return;
  const { base, manifest, themeTokens } = catalog;

  try {
    const variant = variantInput.value === "layout" ? "layout" : "ideal";
    const plan = buildImportPlan(manifest, { baseUrl: base, themeTokens, variant });
    if (plan.imageCount === 0) {
      say("Catalog has no importable renders.");
      return;
    }

    const uniqueImages = dedupeImages(
      plan.groups.flatMap((g) => g.components.flatMap((c) => [...c.images, ...(c.compare ?? [])])),
    );
    const images: { path: string; bytes: Uint8Array }[] = [];
    let done = 0;
    for (const image of uniqueImages) {
      say(`Downloading renders… ${++done}/${uniqueImages.length}`);
      images.push({ path: image.path, bytes: await fetchBytes(image.url) });
    }

    // Fetch the pre-generated wireframe SVGs for the components that land on a
    // screen page (the only surface that shows the vector wireframe lane), and
    // attach the text to the plan so the main thread places it as vector.
    const screenIds = new Set((plan.screens ?? []).flatMap((s) => [s.id, ...(s.related ?? [])]));
    const screenComponents = plan.groups
      .flatMap((g) => g.components)
      .filter((c) => screenIds.has(c.componentId) && c.wireframeUrl);
    let wf = 0;
    for (const component of screenComponents) {
      say(`Fetching wireframes… ${++wf}/${screenComponents.length}`);
      component.wireframeSvg = await fetchText(component.wireframeUrl!);
    }

    // "auto" (the default) defers to the direction the generator stamped into
    // the catalog from the repo's .design-parity.json; an explicit pick overrides.
    const rawMode = modeInput.value === "auto" ? manifest.direction : modeInput.value;
    const direction = resolveDirection(rawMode);
    pending = { plan, images, direction };
    confirmButton.hidden = true;
    // Design-led sends confirm:false first — the main thread replies with a dry
    // run and the Confirm button appears; code-led writes straight away.
    say(direction === "design-led" ? "Checking (design-led — nothing written yet)…" : "Placing on canvas…");
    post(plan, images, direction, false);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
}

/** The {@link PickComponent} currently chosen in the component dropdown. */
function selectedComponent(): PickComponent | undefined {
  return catalog?.index.components.find((c) => c.componentId === componentSelect.value);
}

/** Reset the search and (re)build the grouped component dropdown for a new catalog. */
function populateComponents(_index: CatalogIndex): void {
  pickSearchInput.value = "";
  renderComponentOptions();
}

/**
 * Rebuild the component dropdown as `<optgroup>`s (grouped by component group),
 * filtered by the search box. Keeps the current selection when it's still
 * visible, else selects the first match; then renders that component's controls.
 */
function renderComponentOptions(): void {
  if (!catalog) return;
  const previous = componentSelect.value;
  const groups = groupComponents(catalog.index, pickSearchInput.value);
  componentSelect.replaceChildren();
  for (const group of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.name;
    for (const component of group.components) {
      const option = document.createElement("option");
      option.value = component.componentId;
      option.textContent = component.componentId;
      optgroup.append(option);
    }
    componentSelect.append(optgroup);
  }
  const values = groups.flatMap((g) => g.components.map((c) => c.componentId));
  componentSelect.value = values.includes(previous) ? previous : values[0] ?? "";
  renderPickControls();
  if (values.length === 0) pickCaption.textContent = "No components match your search.";
}

pickSearchInput.addEventListener("input", renderComponentOptions);
componentSelect.addEventListener("change", renderPickControls);

/** Render the variant + dimension controls and format options for the selection. */
function renderPickControls(): void {
  const component = selectedComponent();
  pickCaption.textContent = component?.caption ?? "";

  // Variant (the component's state axis) — hidden when there's no choice.
  if (component?.variant) {
    fillSelect(pickVariant, component.variant.values, "Default");
    pickVariantField.hidden = false;
  } else {
    pickVariantField.hidden = true;
  }

  // One dimension select per axis the catalog carries for this component.
  pickDimensions.replaceChildren();
  for (const axis of component?.dimensions ?? []) {
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    const id = `dim-${axis.key}`;
    label.htmlFor = id;
    label.innerHTML = `${axis.label} <span style="font-weight:400;opacity:0.5">(optional)</span>`;
    const select = document.createElement("select");
    select.id = id;
    select.dataset.key = axis.key;
    fillSelect(select, axis.values, "Any");
    field.append(label, select);
    pickDimensions.append(field);
  }

  // SVG is the wireframe vector — only offered when the component ships one.
  const svgOption = pickFormat.querySelector('option[value="svg"]') as HTMLOptionElement | null;
  if (svgOption) svgOption.disabled = !component?.hasWireframe;
  if (!component?.hasWireframe && pickFormat.value === "svg") pickFormat.value = "png";
}

/** Populate a select with an "any/default" blank option followed by the values. */
function fillSelect(select: HTMLSelectElement, values: string[], blankLabel: string): void {
  select.replaceChildren();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  select.append(blank);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

/** Read the chosen dimension values (blank entries dropped by the resolver). */
function collectDimensions(): Record<string, string> {
  const dimensions: Record<string, string> = {};
  for (const select of Array.from(pickDimensions.querySelectorAll<HTMLSelectElement>("select[data-key]"))) {
    if (select.value) dimensions[select.dataset.key!] = select.value;
  }
  return dimensions;
}

/** A layer name for an inserted component: id · variant · each chosen dimension. */
function insertName(component: PickComponent, selection: PickSelection): string {
  const parts = [component.componentId];
  if (selection.variant) parts.push(selection.variant);
  for (const value of Object.values(selection.dimensions ?? {})) parts.push(value);
  return parts.join(" · ");
}

confirmButton.addEventListener("click", () => {
  if (!pending) return;
  confirmButton.hidden = true;
  say("Writing to the reference page…");
  post(pending.plan, pending.images, pending.direction, true);
});

cancel.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "cancel" } }, "*");
});

copyButton.addEventListener("click", () => {
  designMapArea.select();
  // execCommand is the reliable clipboard path inside a Figma plugin iframe.
  document.execCommand("copy");
  copyButton.textContent = "Copied";
  setTimeout(() => (copyButton.textContent = "Copy"), 1200);
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === "done") {
    // Design-led dry run: nothing written yet — surface the Confirm affordance.
    if (msg.pendingConfirmation) {
      confirmButton.hidden = false;
      say(msg.summary);
      return;
    }
    const keyNote = msg.fileKeyKnown
      ? ""
      : " (replace the FILE_KEY placeholder — this file has no key yet)";
    say(`${msg.summary} Correspondence for ${msg.componentCount} component${msg.componentCount === 1 ? "" : "s"} ready${keyNote}.`);
    if (msg.componentCount > 0) {
      designMapArea.value = msg.designMap;
      result.hidden = false;
    }
  }
  if (msg.type === "selectionRead") {
    onSelectionRead(msg.read as FrameRead, msg.png as Uint8Array | undefined);
  }
  if (msg.type === "selectionEmpty") {
    proposeSay("Select a frame in Figma, then Read selection.");
  }
  if (msg.type === "registry") {
    // The persisted registry arrived — merge it with the code defaults and
    // reflect the remembered pick. Absent / first-run ⇒ hydrate from defaults.
    registry = hydrateRegistry(msg.stored as StoredRegistry | undefined);
    renderCatalogOptions();
  }
  if (msg.type === "error") say(`Import failed: ${msg.message}`);
  if (msg.type === "inserted") say(`Inserted “${msg.name}”. Pick another, or import the whole catalog.`);
  if (msg.type === "insertError") say(`Insert failed: ${msg.message}`);
  if (msg.type === "livePlaced") {
    editorSay(`Placed “${msg.name}”. Edit the knobs and place again for another variant.`);
  }
  if (msg.type === "liveError") editorSay(`Place failed: ${msg.message}`);
  if (msg.type === "refreshJobs") void runRefreshJobs(msg.jobs);
  if (msg.type === "refreshed") {
    refreshDone += 1;
    editorSay(`Refreshed ${refreshDone}/${refreshExpected}.`);
  }
  if (msg.type === "slotsPlaced") {
    renderSlotFills(msg.container, msg.slots);
    editorSay(`Placed “${msg.container}” with ${msg.slots.length} slot${msg.slots.length === 1 ? "" : "s"} — pick a component for each and Fill.`);
  }
  if (msg.type === "slotFilled") editorSay(`Filled “${msg.name}”.`);
};

/** A placed slot the main thread reports back: its name, node id, and box size. */
interface SlotFill {
  name: string;
  nodeId: string;
  width: number;
  height: number;
}

/**
 * Render a fill control per placed slot: a component picker + a Fill button that
 * renders the chosen component to the slot's exact size and posts it for the main
 * thread to drop into that slot frame.
 */
function renderSlotFills(container: string, slots: SlotFill[]): void {
  slotsPanel.replaceChildren();
  if (slots.length === 0) {
    slotsPanel.hidden = true;
    return;
  }
  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = `Slots in ${container}`;
  slotsPanel.append(title);
  for (const slot of slots) {
    const row = document.createElement("div");
    row.className = "field";
    const label = document.createElement("label");
    label.textContent = `${slot.name} (${slot.width}×${slot.height})`;
    const select = document.createElement("select");
    for (const preview of loaded?.previews ?? []) {
      const option = document.createElement("option");
      option.value = preview.id;
      option.textContent = preview.label;
      select.append(option);
    }
    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "secondary";
    fill.textContent = "Fill";
    fill.addEventListener("click", async () => {
      const child = loaded?.previews.find((p) => p.id === select.value);
      if (!loaded || !child) return;
      const source = renderSourceForPreview(child, {
        serverBase: loaded.serverBase,
        basePath: loaded.system,
        token: loaded.token,
        format: "png",
        axes: slotSizeAxes(slot),
      });
      try {
        editorSay(`Rendering ${child.label} for ${slot.name}…`);
        const bytes = await fetchBytes(buildRenderUrl(source));
        parent.postMessage(
          { pluginMessage: { type: "fillSlot", slotNodeId: slot.nodeId, source, bytes } },
          "*",
        );
      } catch (err) {
        editorSay(err instanceof Error ? err.message : String(err));
      }
    });
    row.append(label, select, fill);
    slotsPanel.append(row);
  }
  slotsPanel.hidden = false;
}

function dedupeImages(images: PlannedImage[]): PlannedImage[] {
  const seen = new Set<string>();
  const out: PlannedImage[] = [];
  for (const image of images) {
    if (seen.has(image.path)) continue;
    seen.add(image.path);
    out.push(image);
  }
  return out;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const views: Record<string, HTMLElement> = {
  catalog: document.getElementById("view-catalog") as HTMLElement,
  editor: document.getElementById("view-editor") as HTMLElement,
  propose: document.getElementById("view-propose") as HTMLElement,
};
for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"))) {
  tab.addEventListener("click", () => {
    const target = tab.dataset.view!;
    for (const other of Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"))) {
      other.setAttribute("aria-selected", String(other === tab));
    }
    for (const [name, el] of Object.entries(views)) el.hidden = name !== target;
  });
}

// ── Override editor ─────────────────────────────────────────────────────────────

const editorForm = document.getElementById("editor-form") as HTMLFormElement;
const serverInput = document.getElementById("server") as HTMLInputElement;
const systemInput = document.getElementById("system") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const editorPick = document.getElementById("editor-pick") as HTMLElement;
const previewSelect = document.getElementById("preview") as HTMLSelectElement;
const knobsDiv = document.getElementById("knobs") as HTMLElement;
const axesDiv = document.getElementById("axes") as HTMLElement;
const placeButton = document.getElementById("place") as HTMLButtonElement;
const placeSlotsButton = document.getElementById("place-slots") as HTMLButtonElement;
const slotsPanel = document.getElementById("slots-panel") as HTMLElement;
const formatSelect = document.getElementById("format") as HTMLSelectElement;
const refreshButton = document.getElementById("refresh") as HTMLButtonElement;
const editorStatus = document.getElementById("editor-status") as HTMLParagraphElement;

/** Progress counters for an in-flight Refresh (main thread reports each node done). */
let refreshExpected = 0;
let refreshDone = 0;

/** The loaded system: its previews plus the coordinates a render request needs. */
let loaded: { previews: Preview[]; serverBase: string; system: string; token: string } | undefined;

function editorSay(text: string): void {
  editorStatus.textContent = text;
}

editorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const serverBase = serverInput.value.trim().replace(/\/+$/, "");
  const system = systemInput.value.trim();
  const token = tokenInput.value.trim();
  if (!serverBase || !system) {
    editorSay("Enter a preview server and a system.");
    return;
  }

  try {
    editorSay("Loading previews…");
    const body = await fetchJson<unknown>(previewsUrl(serverBase, system, token || undefined));
    const response = parsePreviewsResponse(body);
    if (!response || response.previews.length === 0) {
      editorSay("No previews at that server / system.");
      editorPick.hidden = true;
      return;
    }
    loaded = { previews: response.previews, serverBase, system, token };
    populatePreviews(response.previews);
    editorPick.hidden = false;
    editorSay(`${response.previews.length} component${response.previews.length === 1 ? "" : "s"} — pick one, edit its knobs, and place.`);
  } catch (err) {
    editorSay(err instanceof Error ? err.message : String(err));
    editorPick.hidden = true;
  }
});

function populatePreviews(previews: Preview[]): void {
  previewSelect.replaceChildren();
  for (const preview of previews) {
    const option = document.createElement("option");
    option.value = preview.id;
    option.textContent = preview.label;
    previewSelect.append(option);
  }
  renderControls();
}

previewSelect.addEventListener("change", renderControls);

/** Render the knob + axis controls for the selected preview. */
function renderControls(): void {
  const preview = loaded?.previews.find((p) => p.id === previewSelect.value);
  knobsDiv.replaceChildren();
  axesDiv.replaceChildren();
  if (!preview) return;

  for (const control of knobControls(preview)) {
    knobsDiv.append(
      control.kind === "bool"
        ? boolField(control.seedKey, control.label, control.value === "true")
        : textField(`knob-${control.seedKey}`, control.seedKey, control.label, control.value, control.kind),
    );
  }
  for (const axis of EDITOR_AXES) {
    axesDiv.append(textField(`axis-${axis.key}`, axis.key, axis.label, "", "", axis.placeholder));
  }
}

/** A labelled text control tagged with the override key its value is collected under. */
function textField(
  id: string,
  key: string,
  labelText: string,
  value: string,
  kind: string,
  placeholder = "",
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "knob";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  if (kind) {
    const kindTag = document.createElement("span");
    kindTag.className = "kind";
    kindTag.textContent = kind;
    label.append(kindTag);
  }
  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.dataset.key = key;
  wrap.append(label, input);
  return wrap;
}

/** A checkbox control for a `bool` knob. */
function boolField(key: string, labelText: string, checked: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "knob bool";
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.dataset.key = key;
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  wrap.append(label);
  return wrap;
}

/** Read the knob edits (keyed by seed key) from the rendered controls. */
function collectEdits(): Record<string, string> {
  const edits: Record<string, string> = {};
  for (const input of Array.from(knobsDiv.querySelectorAll<HTMLInputElement>("input[data-key]"))) {
    edits[input.dataset.key!] = input.type === "checkbox" ? String(input.checked) : input.value;
  }
  return edits;
}

/** Read the display-axis values from the rendered controls (blanks are dropped downstream). */
function collectAxes(): Record<string, string> {
  const axes: Record<string, string> = {};
  for (const input of Array.from(axesDiv.querySelectorAll<HTMLInputElement>("input[data-key]"))) {
    axes[input.dataset.key!] = input.value.trim();
  }
  return axes;
}

refreshButton.addEventListener("click", () => {
  editorSay("Refreshing selection…");
  parent.postMessage({ pluginMessage: { type: "refresh" } }, "*");
});

/**
 * Fetch each planned job and hand it back to the main thread to apply: a PNG job
 * as bytes (main thread swaps the fill), an SVG job as text (main thread re-places
 * the vector node).
 */
async function runRefreshJobs(
  jobs: { nodeId: string; url: string; format: "png" | "svg" }[],
): Promise<void> {
  if (jobs.length === 0) {
    editorSay("Select a placed live render on the canvas, then Refresh.");
    return;
  }
  refreshExpected = jobs.length;
  refreshDone = 0;
  editorSay(`Refreshing ${jobs.length} render${jobs.length === 1 ? "" : "s"}…`);
  for (const job of jobs) {
    try {
      if (job.format === "svg") {
        const svg = await fetchText(job.url);
        parent.postMessage(
          { pluginMessage: { type: "applyRefreshSvg", nodeId: job.nodeId, svg } },
          "*",
        );
      } else {
        const bytes = await fetchBytes(job.url);
        parent.postMessage(
          { pluginMessage: { type: "applyRefresh", nodeId: job.nodeId, bytes } },
          "*",
        );
      }
    } catch (err) {
      editorSay(err instanceof Error ? err.message : String(err));
    }
  }
}

placeButton.addEventListener("click", async () => {
  const preview = loaded?.previews.find((p) => p.id === previewSelect.value);
  if (!loaded || !preview) return;

  const format = formatSelect.value === "svg" ? "svg" : "png";
  const source = renderSourceForPreview(preview, {
    serverBase: loaded.serverBase,
    basePath: loaded.system,
    token: loaded.token,
    format,
    knobEdits: collectEdits(),
    axes: collectAxes(),
  });
  const url = buildRenderUrl(source);

  try {
    editorSay("Rendering…");
    if (format === "svg") {
      // SVG imports as editable vector: post the text for figma.createNodeFromSvg.
      const svg = await fetchText(url);
      parent.postMessage(
        { pluginMessage: { type: "placeLiveSvg", source, svg, name: preview.label } },
        "*",
      );
    } else {
      const bytes = await fetchBytes(url);
      parent.postMessage(
        { pluginMessage: { type: "placeLive", source, bytes, name: preview.label } },
        "*",
      );
    }
  } catch (err) {
    editorSay(err instanceof Error ? err.message : String(err));
  }
});

placeSlotsButton.addEventListener("click", async () => {
  const preview = loaded?.previews.find((p) => p.id === previewSelect.value);
  if (!loaded || !preview) return;

  // A slotted container places as a PNG; its slot boxes come from /render/<id>.slots.
  const source = renderSourceForPreview(preview, {
    serverBase: loaded.serverBase,
    basePath: loaded.system,
    token: loaded.token,
    format: "png",
    knobEdits: collectEdits(),
    axes: collectAxes(),
  });

  try {
    editorSay("Rendering container + reading slots…");
    const [bytes, slotsBody] = await Promise.all([
      fetchBytes(buildRenderUrl(source)),
      fetchJson<unknown>(buildSlotsUrl(source)),
    ]);
    const slots = parseSlotsResponse(slotsBody);
    if (!slots || slots.slots.length === 0) {
      editorSay("That preview declares no slots (no dp-slot markers).");
      slotsPanel.replaceChildren();
      slotsPanel.hidden = true;
      return;
    }
    parent.postMessage(
      { pluginMessage: { type: "placeWithSlots", source, bytes, slots, name: preview.label } },
      "*",
    );
  } catch (err) {
    editorSay(err instanceof Error ? err.message : String(err));
  }
});

// ── Propose spec ────────────────────────────────────────────────────────────

const readSelectionButton = document.getElementById("read-selection") as HTMLButtonElement;
const proposeStatus = document.getElementById("propose-status") as HTMLParagraphElement;
const proposeOut = document.getElementById("propose-out") as HTMLElement;
const specKindSelect = document.getElementById("spec-kind") as HTMLSelectElement;
const specIdLabel = document.getElementById("spec-id-label") as HTMLLabelElement;
const specIdInput = document.getElementById("spec-id") as HTMLInputElement;
const specUsesInput = document.getElementById("spec-uses") as HTMLInputElement;
const specNotesInput = document.getElementById("spec-notes") as HTMLInputElement;
const downloadPngButton = document.getElementById("download-png") as HTMLButtonElement;
const issueBodyArea = document.getElementById("issue-body") as HTMLTextAreaElement;
const specJsonArea = document.getElementById("spec-json") as HTMLTextAreaElement;
const copyIssueButton = document.getElementById("copy-issue") as HTMLButtonElement;
const copySpecButton = document.getElementById("copy-spec") as HTMLButtonElement;

/** The last frame the main thread read, plus its exported PNG (for download + rebuild). */
let lastRead: FrameRead | undefined;
let lastPng: Uint8Array | undefined;

function proposeSay(text: string): void {
  proposeStatus.textContent = text;
}

readSelectionButton.addEventListener("click", () => {
  proposeSay("Reading the selection…");
  parent.postMessage({ pluginMessage: { type: "proposeReadSelection" } }, "*");
});

/** A frame was read: seed the kind/id/uses, reveal the output, render the spec. */
function onSelectionRead(read: FrameRead, png: Uint8Array | undefined): void {
  lastRead = read;
  lastPng = png;
  specKindSelect.value = suggestKind(read);
  specIdInput.value = defaultComponentId(read.name);
  specUsesInput.value = read.components.join(", ");
  updateIdLabel();
  downloadPngButton.hidden = !png;
  proposeOut.hidden = false;
  renderProposeSpec();
  proposeSay(`Read “${read.name}”. Pick the kind, edit the id / references, then copy the issue.`);
}

/** Label the id field for the current kind (a screen has a screen id). */
function updateIdLabel(): void {
  specIdLabel.textContent = specKindSelect.value === "screen" ? "Screen id" : "Component id";
}

/** Rebuild the issue body + spec.json from the last read and the editable fields. */
function renderProposeSpec(): void {
  if (!lastRead) return;
  const uses = specUsesInput.value.split(",").map((s) => s.trim()).filter(Boolean);
  const spec = buildFrameSpec(lastRead, {
    kind: specKindSelect.value as SpecKind,
    targetId: specIdInput.value,
    uses,
    notes: specNotesInput.value,
  });
  issueBodyArea.value = specToIssueBody(spec);
  specJsonArea.value = specToJson(spec);
}

specKindSelect.addEventListener("change", () => {
  updateIdLabel();
  renderProposeSpec();
});
specIdInput.addEventListener("input", renderProposeSpec);
specUsesInput.addEventListener("input", renderProposeSpec);
specNotesInput.addEventListener("input", renderProposeSpec);

/** Copy a textarea's contents (execCommand is the reliable path in a Figma iframe). */
function copyArea(area: HTMLTextAreaElement, button: HTMLButtonElement): void {
  area.select();
  document.execCommand("copy");
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = original), 1200);
}

copyIssueButton.addEventListener("click", () => copyArea(issueBodyArea, copyIssueButton));
copySpecButton.addEventListener("click", () => copyArea(specJsonArea, copySpecButton));

downloadPngButton.addEventListener("click", () => {
  if (!lastPng || !lastRead) return;
  // A Blob download link is the only way out of the sandbox for the exported bytes.
  // Copy into a standalone ArrayBuffer so the Blob part is concretely typed.
  const buffer = new ArrayBuffer(lastPng.byteLength);
  new Uint8Array(buffer).set(lastPng);
  const blob = new Blob([buffer], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${defaultComponentId(lastRead.name).replace(/\//g, "-")}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
});
