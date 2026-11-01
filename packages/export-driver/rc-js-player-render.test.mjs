/**
 * rc-js-player-render.test.mjs — the `rc` lane's render loop keeps a document's downloaded faces
 * however slowly the font server answers.
 *
 * `rc-compare.mjs` renders a document again when the render changed the page's font faces, and stops
 * when one leaves them as it found them. It used to read that state while a face was still
 * downloading: a face the final paint had only just asked for counted as "not loaded" before and
 * after the render, so a slow answer looked like "nothing changed" and the render drawn in the
 * fallback face was kept. `typeface_variable_weight` came back that way in about one full-suite run
 * in twelve, and `rc-cmp-wasm-compare-concurrency.test.mjs` reported it as a difference between
 * `--concurrency 1` and `--concurrency 3`.
 *
 * Hermetic: a local server stands in for the Google Fonts CSS API (the player's `baseUrl` knob) and
 * serves the vendored Roboto Flex, once promptly and once with every font file held back, so the slow
 * case is a fixed condition rather than whatever the network does on the day.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_FONTS_DIR } from "./rc-fonts.mjs";
import { renderRcDocumentOnce, renderUntilFontsSettle } from "./rc-js-player-render.mjs";
import { RC_PLAYER_JS_BUNDLE, rcPlayerBundleIssue } from "./rc-player-bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Four lines of `google:Roboto Flex` at wght 100, 400, 700 and 1000: one enumerated-weight
// stylesheet and three ranged axis stylesheets, which is the shape that left a face loading.
const DOCUMENT = fs.readFileSync(path.join(HERE, "fixtures/typeface-variable-weight.rc")).toString("base64");
const FONT_FILE = "RobotoFlex.ttf";
const SLOW_MS = 1500;

let browser;
let server;
let origin;
let skip = false;

before(async () => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    skip = "playwright is not installed";
    return;
  }
  const bundleIssue = rcPlayerBundleIssue();
  if (bundleIssue) {
    skip = bundleIssue;
    return;
  }
  const fontPath = path.join(DEFAULT_FONTS_DIR, FONT_FILE);
  if (!fs.existsSync(fontPath)) {
    skip = `${FONT_FILE} is not vendored`;
    return;
  }
  const font = fs.readFileSync(fontPath);
  // `/<speed>/css2` answers like the real API and points every face at `/<speed>/font.ttf`.
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const [, speed, file] = url.pathname.split("/");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><head></head><body></body></html>");
    } else if (file === "css2") {
      const [family, axes] = url.searchParams.get("family").split(":");
      const range = /@([\d.]+)\.\.([\d.]+)$/.exec(axes);
      const face = (weight) =>
        `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:block;src:url(${origin}/${speed}/font.ttf) format('truetype');}`;
      res.writeHead(200, { "content-type": "text/css", "access-control-allow-origin": "*" });
      // The axis request `wght@100..700` gets one face declaring exactly that range, as the real
      // API answers it; the enumerated request gets one face per weight it lists.
      res.end(
        range
          ? face(`${range[1]} ${range[2]}`)
          : [100, 200, 300, 400, 500, 600, 700, 800, 900].map(face).join(""),
      );
    } else if (file === "font.ttf") {
      const send = () => {
        res.writeHead(200, { "content-type": "font/ttf", "access-control-allow-origin": "*" });
        res.end(font);
      };
      if (speed === "slow") setTimeout(send, SLOW_MS);
      else send();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.RC_COMPARE_CHROMIUM ? { executablePath: process.env.RC_COMPARE_CHROMIUM } : {}),
      args: ["--no-sandbox"],
    });
  } catch (e) {
    skip = `chromium unavailable: ${String(e).split("\n")[0]}`;
  }
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** A fresh page with the player loaded and its web fonts pointed at [speed]'s server. */
async function playerPage(speed) {
  const page = await browser.newContext({ deviceScaleFactor: 1 }).then((c) => c.newPage());
  await page.goto(`${origin}/`);
  await page.addScriptTag({ content: fs.readFileSync(RC_PLAYER_JS_BUNDLE, "utf8") });
  await page.evaluate(
    ({ base, enabled }) => {
      const RC = globalThis.RC ?? globalThis.RcdPlayerBundle;
      RC.configureWebFonts({ baseUrl: base, enabled });
    },
    { base: `${origin}/${speed}/css2`, enabled: speed !== "none" },
  );
  return page;
}

const once = (page) => renderRcDocumentOnce(page, { b64: DOCUMENT, width: 200, height: 200, theme: "light" });

async function settled(speed) {
  const page = await playerPage(speed);
  try {
    const result = await renderUntilFontsSettle(page, () => once(page));
    assert.equal(result.error, undefined, result.error);
    return result.dataUrl;
  } finally {
    await page.context().close();
  }
}

test("a slow font server changes nothing: the render keeps the faces it asked for", async (t) => {
  if (skip) return t.skip(skip);
  const prompt = await settled("fast");
  // Guard: the faces have to be visible in the pixels, or equality below would prove nothing.
  assert.notEqual(prompt, await settled("none"), "the document renders the same without its web font");

  // Guard: the slow server really does leave a face downloading when a single render returns —
  // that is the state the loop used to mistake for a settled one.
  const page = await playerPage("slow");
  try {
    await once(page);
    const loading = await page.evaluate(() => {
      let n = 0;
      document.fonts.forEach((face) => {
        if (face.status === "loading") n++;
      });
      return n;
    });
    assert.ok(loading > 0, "no face was still loading after a render against the slow server");
  } finally {
    await page.context().close();
  }

  assert.equal(await settled("slow"), prompt, "the slow server's render kept a fallback face");
});
