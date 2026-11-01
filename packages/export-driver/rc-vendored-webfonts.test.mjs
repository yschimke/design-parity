/**
 * rc-vendored-webfonts.test.mjs — the `rc` lane serves `google:` families from the vendored font
 * directory instead of the Google Fonts CDN, whose answer varies from request to request.
 *
 * Why it matters: the CDN answers the same css2 request sometimes with its static `/s/…` file and
 * sometimes with a `/l/font?kit=…` one, and the two drew `typeface_variable_weight` one pixel apart —
 * which `rc-cmp-wasm-compare-concurrency.test.mjs` reported as `--concurrency 3` changing a render.
 *
 * Needs the vendored faces and their `fonts.json` (`RC_FONTS_DIR`, as CI's browser job sets it).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_FONTS_DIR } from "./rc-fonts.mjs";
import { renderRcDocumentOnce, renderUntilFontsSettle } from "./rc-js-player-render.mjs";
import { RC_PLAYER_JS_BUNDLE, rcPlayerBundleIssue } from "./rc-player-bundle.mjs";
import {
  fvarDescriptors,
  routeVendoredWebFonts,
  vendoredWebFontFamilies,
} from "./rc-vendored-webfonts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = DEFAULT_FONTS_DIR;
const MISSING = ["fonts.json", "RobotoFlex.ttf", "LobsterTwo-Regular.ttf"].find(
  (file) => !fs.existsSync(path.join(DIR, file)),
);
const NOT_VENDORED = MISSING && `${MISSING} is not vendored`;

/** A stand-in for a Playwright page that records its route handlers. */
function fakePage() {
  const handlers = [];
  return {
    handlers,
    route: async (pattern, handler) => handlers.push({ pattern, handler }),
    /** Run the handler whose pattern matches [url], the way Playwright would. */
    request(url) {
      const { handler } = handlers.find(({ pattern }) =>
        pattern instanceof RegExp ? pattern.test(url) : url.startsWith(pattern.replace(/\*\*$/, "")),
      );
      return handler({
        request: () => ({ url: () => url }),
        continue: () => ({ continued: true }),
        fulfill: (response) => response,
      });
    },
  };
}

test("the manifest's default and named families are vendored; generic ones are not", (t) => {
  if (NOT_VENDORED) return t.skip(NOT_VENDORED);
  const families = vendoredWebFontFamilies(DIR);
  assert.ok(families.has("roboto flex"), [...families.keys()].join(", "));
  assert.ok(!families.has("serif") && !families.has("monospace"));
  for (const { files } of families.values()) {
    for (const { file } of files) assert.ok(fs.existsSync(path.join(DIR, file)), file);
  }
  assert.equal(vendoredWebFontFamilies(path.join(HERE, "fixtures")).size, 0, "no manifest, nothing vendored");
  // `--fonts` / `RC_FONTS_DIR` may be relative to the working directory; it must vendor the same set.
  assert.deepEqual(
    [...vendoredWebFontFamilies(path.relative(process.cwd(), DIR)).keys()],
    [...families.keys()],
    "a relative font directory vendors the same families",
  );
});

test("a variable face declares its fvar ranges, so axis values are applied rather than clamped", (t) => {
  if (NOT_VENDORED) return t.skip(NOT_VENDORED);
  assert.deepEqual(fvarDescriptors(fs.readFileSync(path.join(DIR, "RobotoFlex.ttf"))), {
    weight: "100 1000",
    stretch: "25% 151%",
  });
  assert.deepEqual(fvarDescriptors(fs.readFileSync(path.join(DIR, "LobsterTwo-Regular.ttf"))), {});
});

test("a vendored family is answered locally; any other family still goes to the network", async (t) => {
  if (NOT_VENDORED) return t.skip(NOT_VENDORED);
  const page = fakePage();
  assert.ok((await routeVendoredWebFonts(page, DIR)).includes("Roboto Flex"));

  const css = await page.request(
    "https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@100..1000&display=block",
  );
  assert.equal(css.status, 200);
  assert.match(css.body, /font-family:'Roboto Flex';font-style:normal;font-weight:100 1000;font-stretch:25% 151%;/);
  const src = /src:url\(([^)]+)\)/.exec(css.body)[1];
  assert.ok(!/fonts\.gstatic\.com\/(s|l)\//.test(src), src);
  assert.ok((await page.request(src)).body.equals(fs.readFileSync(path.join(DIR, "RobotoFlex.ttf"))));

  assert.deepEqual(
    await page.request("https://fonts.googleapis.com/css2?family=Not+Vendored:wght@400&display=block"),
    { continued: true },
  );
  assert.equal((await page.request(src.replace("RobotoFlex.ttf", "..%2Fsecret"))).status, 404);
});

let browser;
let browserSkip = NOT_VENDORED || rcPlayerBundleIssue();

before(async () => {
  if (browserSkip) return;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      ...(process.env.RC_COMPARE_CHROMIUM ? { executablePath: process.env.RC_COMPARE_CHROMIUM } : {}),
      args: ["--no-sandbox"],
    });
  } catch (e) {
    browserSkip = `chromium unavailable: ${String(e).split("\n")[0]}`;
  }
});

after(async () => {
  await browser?.close();
});

test("the player renders a google: specimen from the vendored file, never Google's", async (t) => {
  if (browserSkip) return t.skip(browserSkip);
  const b64 = fs.readFileSync(path.join(HERE, "fixtures/typeface-variable-weight.rc")).toString("base64");
  const renders = [];
  const googleFiles = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("request", (request) => {
      if (/^https:\/\/fonts\.gstatic\.com\/(s|l)\//.test(request.url())) googleFiles.push(request.url());
    });
    await routeVendoredWebFonts(page, DIR);
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addScriptTag({ content: fs.readFileSync(RC_PLAYER_JS_BUNDLE, "utf8") });
    const once = () => renderRcDocumentOnce(page, { b64, width: 200, height: 200, theme: "light" });
    const result = await renderUntilFontsSettle(page, once);
    assert.equal(result.error, undefined, result.error);
    renders.push(result.dataUrl);
    const faces = await page.evaluate(() => {
      const loaded = [];
      document.fonts.forEach((face) => {
        if (face.status === "loaded") loaded.push(`${face.family} ${face.weight}`);
      });
      return loaded;
    });
    // Guard: the specimen really did use the routed face, rather than rendering in a fallback.
    assert.ok(faces.some((face) => /Roboto Flex/.test(face)), faces.join(", "));
    await context.close();
  }
  assert.deepEqual(googleFiles, []);
  assert.equal(renders[1], renders[0]);
});
