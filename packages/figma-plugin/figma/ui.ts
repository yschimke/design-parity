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

import { resolveDirection, type ParityDirection } from "../src/direction.js";
import { readDtcgTokensLite } from "../src/dtcg.js";
import { EDITOR_AXES, knobControls } from "../src/editor.js";
import { buildImportPlan, type ImportPlan, type PlannedImage } from "../src/plan.js";
import {
  parsePreviewsResponse,
  previewsUrl,
  renderSourceForPreview,
  type Preview,
} from "../src/previews.js";
import { buildRenderUrl } from "../src/render.js";

const form = document.getElementById("form") as HTMLFormElement;
const baseInput = document.getElementById("base") as HTMLInputElement;
const variantInput = document.getElementById("variant") as HTMLSelectElement;
const modeInput = document.getElementById("mode") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const cancel = document.getElementById("cancel") as HTMLButtonElement;
const confirmButton = document.getElementById("confirm") as HTMLButtonElement;
const result = document.getElementById("result") as HTMLElement;
const designMapArea = document.getElementById("designmap") as HTMLTextAreaElement;
const copyButton = document.getElementById("copy") as HTMLButtonElement;

/** The last resolved import, retained so a design-led confirm can re-send it. */
let pending: { plan: ImportPlan; images: { path: string; bytes: Uint8Array }[]; direction: ParityDirection } | undefined;

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const base = baseInput.value.trim().replace(/\/+$/, "");
  if (!base) {
    say("Enter a catalog base URL.");
    return;
  }

  try {
    say("Fetching catalog.json…");
    const manifest = await fetchJson<CatalogManifest>(`${base}/catalog.json`);

    let themeTokens;
    if (manifest.tokensFile) {
      say("Fetching design tokens…");
      const doc = await fetchJson<unknown>(`${base}/${manifest.tokensFile}`);
      themeTokens = readDtcgTokensLite(doc);
    }

    const variant = variantInput.value === "layout" ? "layout" : "ideal";
    const plan = buildImportPlan(manifest, { baseUrl: base, themeTokens, variant });
    if (plan.imageCount === 0) {
      say("Catalog has no importable renders.");
      return;
    }

    const uniqueImages = dedupeImages(plan.groups.flatMap((g) => g.components.flatMap((c) => c.images)));
    const images: { path: string; bytes: Uint8Array }[] = [];
    let done = 0;
    for (const image of uniqueImages) {
      say(`Downloading renders… ${++done}/${uniqueImages.length}`);
      images.push({ path: image.path, bytes: await fetchBytes(image.url) });
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
});

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
  if (msg.type === "error") say(`Import failed: ${msg.message}`);
  if (msg.type === "livePlaced") {
    editorSay(`Placed “${msg.name}”. Edit the knobs and place again for another variant.`);
  }
  if (msg.type === "liveError") editorSay(`Place failed: ${msg.message}`);
  if (msg.type === "refreshJobs") void runRefreshJobs(msg.jobs);
  if (msg.type === "refreshed") {
    refreshDone += 1;
    editorSay(`Refreshed ${refreshDone}/${refreshExpected}.`);
  }
};

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

/** Fetch each planned job's bytes and hand them back to the main thread to re-fill. */
async function runRefreshJobs(jobs: { nodeId: string; url: string }[]): Promise<void> {
  if (jobs.length === 0) {
    editorSay("Select a placed live render on the canvas, then Refresh.");
    return;
  }
  refreshExpected = jobs.length;
  refreshDone = 0;
  editorSay(`Refreshing ${jobs.length} render${jobs.length === 1 ? "" : "s"}…`);
  for (const job of jobs) {
    try {
      const bytes = await fetchBytes(job.url);
      parent.postMessage({ pluginMessage: { type: "applyRefresh", nodeId: job.nodeId, bytes } }, "*");
    } catch (err) {
      editorSay(err instanceof Error ? err.message : String(err));
    }
  }
}

placeButton.addEventListener("click", async () => {
  const preview = loaded?.previews.find((p) => p.id === previewSelect.value);
  if (!loaded || !preview) return;

  const source = renderSourceForPreview(preview, {
    serverBase: loaded.serverBase,
    basePath: loaded.system,
    token: loaded.token,
    format: "png",
    knobEdits: collectEdits(),
    axes: collectAxes(),
  });

  try {
    editorSay("Rendering…");
    const bytes = await fetchBytes(buildRenderUrl(source));
    parent.postMessage(
      { pluginMessage: { type: "placeLive", source, bytes, name: preview.label } },
      "*",
    );
  } catch (err) {
    editorSay(err instanceof Error ? err.message : String(err));
  }
});
