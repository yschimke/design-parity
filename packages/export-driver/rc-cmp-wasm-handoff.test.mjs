/**
 * rc-cmp-wasm-handoff.test.mjs — the player's `?handoffDelayMs` contract, from both sides.
 *
 * Run with `node --test scripts/design-artifacts/`. Skipped unless the player distribution is
 * built (`./gradlew :rc-player-wasm:wasmPlayerDist`, or point `RC_CMP_WASM_DIST` at one); set
 * `RC_CMP_WASM_REQUIRE=1` to turn those skips into failures, as the CI job does.
 *
 * The player holds back `ready` for 1.5 s after its frames have gone through, so a host that
 * reveals it on that signal — viewer.js's `revealRcWasm` swaps the snapshot for the iframe — cannot
 * show a surface the compositor has not presented. That tail is also ~1.5 s of every parity render,
 * around three minutes across a 122-preview catalog, and the parity driver cannot flash: it
 * screenshots through CDP, which drives its own compositor frame, then checks every pixel against
 * the baked reference. So the driver passes `handoffDelayMs=0` and the viewer keeps the default.
 *
 * Both halves are pinned here because each fails silently on its own. Drop the default and the
 * viewer regains a blank-frame flash that no capture in this repo can observe — screenshots and CDP
 * screencasts both drive frames of their own, so the hazard survives only as a guard, not a test.
 * Ignore the parameter and the driver quietly pays the tail again, which is how it went unnoticed
 * for as long as it did.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHROMIUM_LAUNCH_ARGS } from "./rc-chromium.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(
  process.env.RC_CMP_WASM_DIST || path.join(HERE, "../../rc-player/wasm/build/wasmDist"),
);
const FIXTURE = path.join(HERE, "fixtures", "watch-screen-round-clip.rc");
const VIEWPORT = { width: 227, height: 227 };
const DENSITY = 2;
// The default tail is 1,500 ms. A *lower* bound on the default render is safe on any machine — a
// slow one only overshoots it, and nothing but a missing tail can undershoot.
const MIN_DEFAULT_MS = 1_200;
// The tail-free render is *not* judged by its wall-clock time. That used to be checked as the
// difference between a tail-free navigation and a default one, needing more than 1,000 ms between
// them — a 500 ms margin under a 1,500 ms tail. But each side is a whole navigation, Wasm startup,
// font load and three frames, and on a loaded runner (this file runs beside ~1,450 other tests) one
// navigation alone varies by more than a second: CI saw 2,252 ms against 3,121 ms, an 869 ms
// "saving" from a parameter that was applied. Instead the page records the delay of every timer that
// *runs* before the player reports `ready`. The tail is a coroutine `delay(handoffDelayMs)`, which
// the Kotlin/Wasm dispatcher arms through `window.setTimeout`, so the default render runs a timer of
// at least MIN_DEFAULT_MS on its way to `ready` and a tail-free one runs none — a fact about which
// timers fired, not about how fast the machine was. The other timers stay below the bound: the font
// load's 8 s `withTimeout` is cancelled rather than run (or the render fails), and the fixture's
// clock tick waits at most 1,000 ms for the next second.
const REQUIRE = process.env.RC_CMP_WASM_REQUIRE === "1";

let chromium;
let browser;
let server;
let origin;
let skip = false;

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".mjs") || file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

before(async () => {
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    skip = "playwright is not installed";
    return;
  }
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    skip = "the CMP/Wasm player distribution is not built";
    return;
  }
  const document = fs.readFileSync(FIXTURE);
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/document.rc") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(document);
      return;
    }
    const file = path.resolve(DIST, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.RC_COMPARE_CHROMIUM ? { executablePath: process.env.RC_COMPARE_CHROMIUM } : {}),
      args: [...CHROMIUM_LAUNCH_ARGS],
    });
  } catch (e) {
    skip = `chromium unavailable: ${String(e).split("\n")[0]}`;
  }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

/**
 * Page init script: record, in `window.__rcTimersBeforeReady`, the requested delay of every
 * `setTimeout` callback that runs while the player has not yet reported `ready`. Installed per
 * navigation, so each render's list starts empty.
 */
function recordTimersBeforeReady() {
  const ran = [];
  window.__rcTimersBeforeReady = ran;
  const setTimeout = window.setTimeout;
  window.setTimeout = function (handler, ms, ...rest) {
    if (typeof handler !== "function") return setTimeout.call(this, handler, ms, ...rest);
    const wrapped = function (...args) {
      if (document.documentElement.dataset.rcPlayerState !== "ready") ran.push(Number(ms) || 0);
      return handler.apply(this, args);
    };
    return setTimeout.call(this, wrapped, ms, ...rest);
  };
}

/**
 * Render once the way rc-compare does, returning navigation-to-`ready`, the screenshot and — on a
 * page carrying [recordTimersBeforeReady] — the delays of the timers that ran before `ready`.
 */
async function render(page, query) {
  const startedAt = performance.now();
  await page.goto(
    `${origin}/index.html?src=${encodeURIComponent("/document.rc")}&theme=light${query}`,
  );
  await page.waitForFunction(
    () => ["ready", "error"].includes(document.documentElement.dataset.rcPlayerState),
    null,
    { timeout: 60_000 },
  );
  const elapsed = performance.now() - startedAt;
  const { state, timers } = await page.evaluate(() => ({
    state: document.documentElement.dataset.rcPlayerState,
    timers: window.__rcTimersBeforeReady ?? null,
  }));
  assert.equal(state, "ready", "the fixture must actually render");
  return { elapsed, timers, png: await page.screenshot({ omitBackground: true }) };
}

/** The timers in a render's [recordTimersBeforeReady] list long enough to be the cold-start tail. */
function tailTimers(rendered) {
  assert.ok(rendered.timers, "the page must carry recordTimersBeforeReady");
  return rendered.timers.filter((ms) => ms >= MIN_DEFAULT_MS);
}

async function withPage(run) {
  const context = await browser.newContext({ deviceScaleFactor: DENSITY });
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  try {
    return await run(page);
  } finally {
    await context.close();
  }
}

test("the default keeps the cold-start tail the viewer's reveal depends on", async (t) => {
  if (skip && REQUIRE) assert.fail(`RC_CMP_WASM_REQUIRE is set but the guard cannot run: ${skip}`);
  if (skip) return t.skip(skip);
  const elapsed = await withPage(async (page) => {
    await render(page, ""); // warm the context so this measures the tail, not the player's load
    return (await render(page, "")).elapsed;
  });
  assert.ok(
    elapsed >= MIN_DEFAULT_MS,
    `default render reported ready in ${elapsed.toFixed(0)} ms — the tail a host reveal ` +
      `depends on is gone`,
  );
});

test("handoffDelayMs=0 drops the tail without changing a pixel", async (t) => {
  if (skip && REQUIRE) assert.fail(`RC_CMP_WASM_REQUIRE is set but the guard cannot run: ${skip}`);
  if (skip) return t.skip(skip);
  const { fast, settled } = await withPage(async (page) => {
    await page.addInitScript(recordTimersBeforeReady);
    await render(page, "&handoffDelayMs=0");
    const fast = await render(page, "&handoffDelayMs=0");
    // The same document with the full tail is the reference: whatever the driver screenshots
    // without waiting must equal what a fully settled render produces.
    const settled = await render(page, "");
    return { fast, settled };
  });
  // The default render proves the probe sees the tail at all, so a player that stopped arming it
  // through `setTimeout` fails here rather than passing the assertion below vacuously.
  assert.ok(
    tailTimers(settled).length > 0,
    `the default render ran no timer of ${MIN_DEFAULT_MS} ms or more before ready ` +
      `(ran ${JSON.stringify(settled.timers)}) — the tail is no longer a timer this probe can see`,
  );
  assert.deepEqual(
    tailTimers(fast),
    [],
    `handoffDelayMs=0 still waited on a ${MIN_DEFAULT_MS} ms+ timer before ready ` +
      `(ran ${JSON.stringify(fast.timers)}), so the parameter is not being applied`,
  );
  assert.ok(
    fast.png.equals(settled.png),
    "a tail-free render must be byte-identical to a settled one",
  );
});
