/**
 * Regenerate the committed plugin-UI evidence (docs/ui-*.png).
 *
 * Unlike the *canvas* the plugin builds (see canvas-preview.mjs — an offline SVG
 * proof), the plugin's own **iframe UI** is real HTML, so it renders headlessly:
 * this loads the built `figma/dist/plugin/ui.html` in Chromium and screenshots
 * every task view. Catalog and live-preview tasks are driven through their real
 * load paths with offline fixture responses, so the committed evidence contains
 * useful populated states rather than empty shells.
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
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer from "puppeteer-core";

const docs = new URL(".", import.meta.url);
const html = readFileSync(new URL("../figma/dist/plugin/ui.html", import.meta.url), "utf8");
const SAMPLE = JSON.parse(readFileSync(new URL("./sample-catalog.json", import.meta.url), "utf8"));
const EVIDENCE_INPUTS = {
  "figma/ui.html": new URL("../figma/ui.html", import.meta.url),
  "figma/ui.ts": new URL("../figma/ui.ts", import.meta.url),
  "figma/code.ts": new URL("../figma/code.ts", import.meta.url),
  "docs/ui-preview.mjs": new URL("./ui-preview.mjs", import.meta.url),
  "docs/sample-catalog.json": new URL("./sample-catalog.json", import.meta.url),
};
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
    window.fetch = async (url, init) => {
      const target = String(url);
      if (target.endsWith("/catalog.json")) {
        return new Response(JSON.stringify(body.catalog), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.includes("/api/previews")) {
        return new Response(JSON.stringify(body.previews), { status: 200, headers: { "content-type": "application/json" } });
      }
      return orig(url, init);
    };
  }, { catalog: SAMPLE.manifest, previews: PREVIEWS });
  await page.goto(`file://${tmp}`, { waitUntil: "networkidle0" });

  // Task 1: real catalog load → populated component picker.
  await page.click("#form button[type=submit]");
  await page.waitForSelector("#catalog-pick:not([hidden])");
  await page.screenshot({ path: fileURLToPath(new URL("./ui-task-add.png", docs)), fullPage: true });

  // Task 2 shares the same loaded source and exposes import + mapped upgrade.
  await page.click("#tab-library");
  await page.waitForSelector("#catalog-bulk:not([hidden])");
  await page.screenshot({ path: fileURLToPath(new URL("./ui-task-library.png", docs)), fullPage: true });

  // Task 3: real preview load → knobs and axes.
  await page.click("#tab-editor");
  await page.type("#server", "https://preview.coo.ee");
  await page.type("#system", "compose-m3");
  await page.click("#editor-form button[type=submit]");
  await page.waitForSelector("#knobs .knob");
  await page.type("#axis-uiMode", "dark");
  await page.type("#axis-fontScale", "1.5");
  await page.screenshot({ path: fileURLToPath(new URL("./ui-task-customize.png", docs)), fullPage: true });

  // Task 4: simulate the Figma main-thread response after reading a selection.
  await page.click("#tab-propose");
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { pluginMessage: {
      type: "selectionRead",
      read: {
        name: "Checkout card",
        width: 360,
        height: 240,
        layout: { paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24, gap: 16, cornerRadius: 20 },
        texts: ["Order total", "$42.00", "Pay now"],
        variables: ["color/surface", "spacing/large", "radius/large"],
        components: ["Button/Filled", "Divider/Horizontal"],
      },
    } } }));
  });
  await page.waitForSelector("#propose-out:not([hidden])");
  await page.screenshot({ path: fileURLToPath(new URL("./ui-task-handoff.png", docs)), fullPage: true });

  const inputs = Object.fromEntries(Object.entries(EVIDENCE_INPUTS).map(([name, url]) => [
    name,
    createHash("sha256").update(readFileSync(url)).digest("hex"),
  ]));
  writeFileSync(
    new URL("./ui-preview.manifest.json", docs),
    `${JSON.stringify({ schema: "design-parity-ui-preview/v1", inputs }, null, 2)}\n`,
  );

  console.log("wrote docs/ui-task-{add,library,customize,handoff}.png and docs/ui-preview.manifest.json");
} finally {
  await browser.close();
}
