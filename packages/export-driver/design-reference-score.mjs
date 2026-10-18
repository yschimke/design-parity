/**
 * Score a published design reference against the sticker it will be compared with, at publish time.
 *
 * The viewer has always been able to answer "how close is this render to its spec?" — but only
 * after a visitor entered the spec lane and waited for two rasters to decode and normalise. So the
 * one fact a design catalog exists to report was the one fact no page showed at rest, and the chip
 * that led to it said only "Figma". Carrying the number in `references/index.json` puts it on the
 * chip on first paint, for free, on every page that has a reference.
 *
 * ## Why this drives a browser
 *
 * The scorer is not a pixel diff. `format-compare.js` crops both sides to their content box,
 * redraws them into one shared box, converts to luma, and walks an edge-tolerant search with a
 * positional cost — so a Figma export at a different scale or padding than the render is compared
 * on what it *looks like* rather than on where its bytes happen to sit. Restating that in Node
 * would be a second implementation of a subtle algorithm, and the moment the two disagree the chip
 * contradicts the readout it links to — the worst possible failure for a number whose entire job is
 * to be trusted at a glance.
 *
 * So this loads the viewer's own asset into a blank page and calls it. There is exactly one
 * scorer, and the baked number is the number the lane would compute. Chromium is already this
 * script's rasteriser for HTML references, so it is not a new dependency — only a newly
 * unconditional one.
 *
 * ## Failure posture
 *
 * Fail-soft, like every other part of the reference lane: no browser, an undecodable pair, a
 * scorer that throws ⇒ no `match` on that record, and the reference publishes exactly as it did
 * before this file existed. The chip then shows the plain provider label and the lane computes the
 * score live on entry, which is the behaviour every published catalog has today.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The viewer asset, read from the server resources it is served from — NOT a copy. A copy is the
 * thing this module exists to avoid; if this path ever stops resolving, scoring must go dark
 * rather than fall back to some other implementation of the same question.
 *
 * It moved out of this repository with the server (#4732), so the path now resolves into an
 * optional sibling checkout of yschimke/compose-preview-server (`COMPOSE_PREVIEW_SERVER_ROOT`, else
 * a `compose-preview-server` sibling). "Go dark" already handles absence: `openScorer` logs
 * `cannot score references: …` and returns without scoring, which is the stated contract above and
 * exactly what a missing checkout should produce.
 */
const SERVER_ROOT = (() => {
  const explicit = (process.env.COMPOSE_PREVIEW_SERVER_ROOT ?? "").trim();
  if (explicit) return explicit;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../compose-preview-server");
})();
const COMPARE_ASSET = fs.statSync(SERVER_ROOT, { throwIfNoEntry: false })?.isFile()
  ? SERVER_ROOT
  : path.join(
      SERVER_ROOT,
      "server/src/main/resources/ee/schimke/composeai/cli/serve/assets/format-compare.js",
    );

/**
 * Below this a content-box proportion difference is rasteriser noise.
 *
 * MIRRORED from `cli/serve-web/src/compare/thresholds.ts`, which the ported browser surfaces share.
 * This driver runs at publish time under plain node with no build step, so it cannot import from
 * `src/` — the copy stays, and so does this pointer.
 */
const GEOMETRY_REPORT_THRESHOLD = 2;

/** A PNG file as the `data:` URL the in-page scorer loads through its own `loadImage`. */
function dataUri(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

/**
 * Round to `places`, as a number. The manifest is read by a chip that prints one decimal; carrying
 * seventeen significant digits would only make the published JSON churn on rasteriser noise.
 */
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * A scorer bound to a small pool of pages in ONE browser, so a catalog's whole reference set is
 * scored without relaunching Chromium: launching it costs more than every comparison in m3-catalog
 * put together (120 pairs in ~18s against a ~1s launch).
 *
 * A pool rather than one page because the comparison runs on the page's own main thread, so a
 * single page scores one pair at a time on one core. m3-catalog's 1937 pairs took ~7 minutes that
 * way on a four-core runner with three cores idle. Each page is its own browser context, and so
 * its own renderer process, so `concurrency` pages score that many pairs at once. Every page loads
 * the SAME asset, so which page scores a pair cannot change its number.
 *
 * Construct through [openScorer]; `close()` when the run is done.
 */
class DesignReferenceScorer {
  constructor(pages) {
    this.pages = pages;
    this.idle = [...pages];
    this.waiting = [];
  }

  /** How many pairs this scorer can work on at once — one per page. */
  get concurrency() {
    return this.pages.length;
  }

  async acquire() {
    if (this.idle.length > 0) return this.idle.pop();
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(page) {
    const next = this.waiting.shift();
    if (next) next(page);
    else this.idle.push(page);
  }

  /**
   * `{ percent, changedPercent, geometry }` for one pair, or null when it cannot be scored.
   *
   * `percent` is the structural match the lane's readout prints, `changedPercent` the share of
   * pixels the magenta delta map marks, and `geometry` the content-box proportion difference —
   * omitted below the threshold at which it is reporting the rasteriser rather than the design.
   *
   * `scoreVersion` says which pixel path minted them. It is read off the scorer itself rather than
   * written here, and a scorer that cannot name its own kernel publishes no number at all: a served
   * reader drops a match whose version is not the one it would compute with, so an unversioned
   * number would be indistinguishable from a pre-rebaseline one and printed as though it were
   * current.
   */
  async score(referencePng, actualPng) {
    if (!fs.existsSync(referencePng) || !fs.existsSync(actualPng)) return null;
    const page = await this.acquire();
    let result;
    try {
      result = await this.scoreOn(page, referencePng, actualPng);
    } finally {
      this.release(page);
    }
    if (!result || !Number.isFinite(result.percent)) return null;
    // No version, no number. An asset too old to name its kernel is one whose numbers the reader
    // cannot place, and publishing them unversioned is exactly the state D3 exists to end.
    if (!Number.isInteger(result.scoreVersion)) return null;
    return {
      percent: round(result.percent, 2),
      changedPercent: round(result.changedPercent, 2),
      scoreVersion: result.scoreVersion,
      ...(result.geometry >= GEOMETRY_REPORT_THRESHOLD
        ? { geometry: round(result.geometry, 1) }
        : {}),
    };
  }

  /** The raw in-page result for one pair on one page. */
  async scoreOn(page, referencePng, actualPng) {
    return page.evaluate(
      async ([reference, actual]) => {
        const api = window.ComposePreviewCompare;
        if (!api) return null;
        const images = await Promise.all([api.loadImage(reference), api.loadImage(actual)]);
        const score = await api.scoreImages(images[0], images[1]);
        // The delta map is drawn only to be counted — the count is what the readout pairs with the
        // match percentage, and a chip that carried one without the other would be reporting half
        // a comparison. The canvas is never attached to the document.
        const frames = await api.normaliseImageUrls(reference, actual);
        const changed = api.diffCanvases(
          frames.reference,
          frames.candidate,
          document.createElement("canvas"),
        );
        const pixels = frames.width * frames.height;
        return {
          percent: score.percent,
          geometry: score.geometry,
          changedPercent: pixels ? (changed * 100) / pixels : 0,
          // Asked of the scorer that just produced the number, never restated here. A driver that
          // carried its own copy could stamp a version the asset does not implement, which is worse
          // than no version at all: the reader would then trust a number minted by another kernel.
          scoreVersion: api.SCORE_VERSION,
        };
      },
      [dataUri(referencePng), dataUri(actualPng)],
    );
  }

  async close() {
    await this.browser?.close();
  }
}

/**
 * Open a scorer, or null when one can't be had — no Playwright, no Chromium, no viewer asset.
 *
 * Null is a normal outcome, not an error: a fork with no browser installed still publishes its
 * references, just without the baked number. The caller warns once and carries on.
 *
 * `pages` is how many pairs to score at once (see [DesignReferenceScorer]); anything that is not a
 * positive integer means one, which is the behaviour before the pool existed.
 */
export async function openScorer({ executablePath, log = () => {}, pages = 1 } = {}) {
  const poolSize = Number.isInteger(pages) && pages > 0 ? pages : 1;
  if (!fs.existsSync(COMPARE_ASSET)) {
    log(
      `cannot score references: ${path.basename(COMPARE_ASSET)} is not at ${COMPARE_ASSET}; ` +
        "set COMPOSE_PREVIEW_SERVER_ROOT to a server checkout or its format-compare.js to score them",
    );
    return null;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    log("cannot score references: playwright is not installed in this run");
    return null;
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    });
    const asset = fs.readFileSync(COMPARE_ASSET, "utf8");
    const pool = [];
    for (let i = 0; i < poolSize; i++) {
      // `browser.newPage()` gives each page its own context, and so its own renderer process —
      // which is what lets the pool actually run in parallel rather than queue on one thread.
      const page = await browser.newPage();
      // A blank document, not a served page: the scorer needs a canvas and an `Image`, nothing
      // else. `format-compare.js` is now nothing BUT the API — the page-specific blocks it used to
      // carry are custom elements in the surface bundles — so it assigns
      // `window.ComposePreviewCompare` and touches no DOM at all.
      await page.setContent("<!doctype html><meta charset=\"utf-8\"><title>score</title>");
      await page.addScriptTag({ content: asset });
      const ready = await page.evaluate(() => typeof window.ComposePreviewCompare?.scoreImages);
      if (ready !== "function") {
        await browser.close();
        log("cannot score references: the viewer's comparison API did not load");
        return null;
      }
      pool.push(page);
    }
    const scorer = new DesignReferenceScorer(pool);
    scorer.browser = browser;
    return scorer;
  } catch (error) {
    await browser?.close().catch(() => {});
    log(`cannot score references: ${error.message}`);
    return null;
  }
}

/**
 * The verdict band a match percentage falls in: `match`, `close`, or `off`.
 *
 * Restated in `ServeWeb.kt` (the chip's colour) — the thresholds live here because this is where
 * the number is minted, and they are chosen from the distribution a real catalog produces rather
 * than from round numbers. They moved with the metric (issue #4290): a score averaged over the
 * whole canvas put nearly every pair in the high nineties, so the bands sat at 99.5/97 to tell
 * them apart at all. Measured over drawn content instead, wear-m3-catalog's 186 published pairs
 * run 4%..100% with a median of 91 — 63 at or above 95, and the 59 below 85 the divergences a
 * reader would name on sight (a 4% scroll indicator, a 52% picker, a 70% stepper that lost its
 * button fills).
 *
 * Exported so the driver's tests can pin the bands against those same numbers.
 */
export function matchBand(percent) {
  if (!Number.isFinite(percent)) return null;
  if (percent >= 95) return "match";
  if (percent >= 85) return "close";
  return "off";
}
