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

import { readDtcgTokensLite } from "../src/dtcg.js";
import { buildImportPlan, type PlannedImage } from "../src/plan.js";

const form = document.getElementById("form") as HTMLFormElement;
const baseInput = document.getElementById("base") as HTMLInputElement;
const variantInput = document.getElementById("variant") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const cancel = document.getElementById("cancel") as HTMLButtonElement;

function say(text: string): void {
  status.textContent = text;
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

    say("Placing on canvas…");
    parent.postMessage({ pluginMessage: { type: "import", plan, images } }, "*");
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

cancel.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "cancel" } }, "*");
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === "done") say(msg.summary);
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
