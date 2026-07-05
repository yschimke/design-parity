/**
 * UI-iframe entry — the only realm with `fetch` / DOM.
 *
 * It takes a base URL (the raw root of a published `design-artifacts/<system>`
 * branch, or a local `compose-preview serve` host), fetches the catalog
 * manifest + optional DTCG token file, runs the pure {@link buildImportPlan}
 * planner, fetches every planned image's bytes, and posts the resolved plan +
 * bytes to the main thread, which owns the scene. All decisions live in the
 * planner; this file is fetch + progress + postMessage.
 */
import type { CatalogManifest } from "@design-parity/catalog-export";

import { resolveDirection, type ParityDirection } from "../src/direction.js";
import { readDtcgTokensLite } from "../src/dtcg.js";
import { buildImportPlan, type ImportPlan, type PlannedImage } from "../src/plan.js";

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
