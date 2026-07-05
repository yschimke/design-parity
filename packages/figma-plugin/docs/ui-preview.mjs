/**
 * Regenerate the committed plugin-UI evidence (docs/ui-*.png).
 *
 * Unlike the *canvas* the plugin builds (see canvas-preview.mjs — an offline SVG
 * proof), the plugin's own **iframe UI** is real HTML, so it renders headlessly:
 * this loads the built `dist/plugin/ui.html` in Chromium and screenshots each
 * tab. The override-editor tab is driven through its real load path with a
 * stubbed `/api/previews` response so the knob controls actually render.
 *
 * Run after building the plugin bundle:
 *
 *   npm run build --workspace @design-parity/figma-plugin
 *   npm run build:plugin --workspace @design-parity/figma-plugin
 *   CHROME_PATH=/path/to/chrome node packages/figma-plugin/docs/ui-preview.mjs
 *
 * CHROME_PATH defaults to the Playwright-provisioned Chromium under
 * $PLAYWRIGHT_BROWSERS_PATH (the agent sandbox / CI browser).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer from "puppeteer-core";

const docs = new URL(".", import.meta.url);
const html = readFileSync(new URL("../dist/plugin/ui.html", import.meta.url), "utf8");
// setContent/goto both need a real document for the inlined <script> + our stub;
// a temp file gives a stable file:// URL that evaluateOnNewDocument applies to.
const tmp = join(tmpdir(), "design-parity-ui-preview.html");
writeFileSync(tmp, html);

/** A stub v2 /api/previews body so the editor renders real controls offline. */
const PREVIEWS = {
  schema: "compose-preview-serve/v2",
  module: "compose-m3",
  previews: [
    {
      id: "Button/Filled",
      label: "Filled button",
      modes: ["snapshot"],
      overrides: [
        { key: "label", type: "string", label: "Label", default: { type: "string", value: "Tap me" }, current: { type: "string", value: "Save" } },
        { key: "enabled", type: "bool", label: "Enabled", default: { type: "bool", value: true } },
        { key: "iconSlot", type: "string", label: "Leading icon", default: { type: "string", value: "" } },
      ],
    },
    { id: "Switch/On", label: "Switch (on)", modes: ["snapshot"], overrides: [
      { key: "checked", type: "bool", label: "Checked", default: { type: "bool", value: true } },
    ] },
  ],
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const hits = globSync(`${root}/chromium-*/chrome-linux/chrome`);
  if (hits.length === 0) throw new Error(`no Chromium under ${root}; set CHROME_PATH`);
  return hits.sort().at(-1);
}

const browser = await puppeteer.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 452, height: 660, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((body) => {
    // The main thread doesn't exist here — swallow the postMessage bridge.
    try { Object.defineProperty(window, "parent", { value: { postMessage() {} }, configurable: true }); } catch {}
    const orig = window.fetch.bind(window);
    window.fetch = async (url, init) =>
      String(url).includes("/api/previews")
        ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
        : orig(url, init);
  }, PREVIEWS);
  await page.goto(`file://${tmp}`, { waitUntil: "networkidle0" });

  await page.screenshot({ path: fileURLToPath(new URL("./ui-catalog.png", docs)), fullPage: true });

  await page.click("#tab-editor");
  await page.type("#server", "https://preview.coo.ee");
  await page.type("#system", "compose-m3");
  await page.click("#editor-form button[type=submit]");
  await page.waitForSelector("#knobs .knob");
  await page.type("#axis-uiMode", "dark");
  await page.type("#axis-fontScale", "1.5");
  await page.screenshot({ path: fileURLToPath(new URL("./ui-override-editor.png", docs)), fullPage: true });

  console.log("wrote docs/ui-catalog.png, docs/ui-override-editor.png");
} finally {
  await browser.close();
}
