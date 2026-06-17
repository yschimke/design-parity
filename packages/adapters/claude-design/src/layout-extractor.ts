/**
 * Capture a reference layout tree from an HTML export.
 *
 * The adapter's image rasterizer uses CLI Chrome `--screenshot`, which has no
 * DOM access, so geometry is read in a separate pass: drive Chrome on PATH via
 * `puppeteer-core` (which bundles **no** browser) and read each labelled leaf
 * element's `getBoundingClientRect` into a flat {@link SemanticTree} (bounds in
 * dp / CSS px). `puppeteer-core` is imported lazily and kept out of the
 * package's hard dependencies — a consumer that doesn't need the structural
 * layout diff never pays for it, and if it (or Chrome) is absent the extractor
 * returns `undefined` and the layout diff simply doesn't run.
 */
import { pathToFileURL } from "node:url";

import type { SemanticNode, SemanticTree } from "@design-parity/core";

/** A request to capture one HTML export's layout. */
export interface LayoutRequest {
  /** Absolute path to the HTML export to measure. */
  htmlPath: string;
  /** CSS width to render at — the design's dp width. Defaults to 411. */
  widthDp?: number;
  /** CSS height to render at. Defaults to 914. */
  heightDp?: number;
}

/** Captures a reference layout tree, or `undefined` when it can't. */
export type LayoutExtractor = (req: LayoutRequest) => Promise<SemanticTree | undefined>;

/** Chrome/Chromium executables to try, in order of preference. */
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "chrome",
].filter((c): c is string => typeof c === "string" && c.length > 0);

/** The raw per-element record pulled out of the page. */
interface RawRect {
  label: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Default extractor: render the export headlessly via `puppeteer-core` and read
 * the bounds of every labelled leaf element (an element with text and no
 * element children) into a flat tree. Returns `undefined` if `puppeteer-core`
 * isn't installed or no Chrome launches.
 */
export const puppeteerLayoutExtractor: LayoutExtractor = async (req) => {
  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = (await import("puppeteer-core")).default as unknown as typeof import("puppeteer-core");
  } catch {
    return undefined; // optional dep absent — layout diff stays dormant
  }

  const url = pathToFileURL(req.htmlPath).href;
  for (const executablePath of CHROME_CANDIDATES) {
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
      browser = await puppeteer.launch({
        executablePath,
        args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
        headless: "shell",
      });
    } catch {
      continue; // try the next candidate binary
    }
    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: req.widthDp ?? 411,
        height: req.heightDp ?? 914,
        deviceScaleFactor: 1,
      });
      await page.goto(url, { waitUntil: "networkidle0" });
      // These callbacks run in the browser; reach the DOM via `globalThis` so
      // the package needn't pull in the TS "dom" lib for its Node build.
      await page.evaluate(async () => {
        const doc = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document;
        await doc?.fonts?.ready;
      });
      const rects = (await page.evaluate(() => {
        const doc = (globalThis as { document?: unknown }).document as {
          querySelectorAll(s: string): ArrayLike<Record<string, unknown>>;
        };
        const out: RawRect[] = [];
        for (const el of Array.from(doc.querySelectorAll("body *")) as Array<{
          children: { length: number };
          textContent: string | null;
          getAttribute(n: string): string | null;
          getBoundingClientRect(): { x: number; y: number; width: number; height: number };
        }>) {
          if (el.children.length === 0 && (el.textContent ?? "").trim()) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              out.push({
                label: (el.textContent ?? "").trim(),
                role: el.getAttribute("role"),
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
              });
            }
          }
        }
        return out;
      })) as RawRect[];
      return treeFromRects(rects, {
        width: req.widthDp ?? 411,
        height: req.heightDp ?? 914,
      });
    } finally {
      await browser.close();
    }
  }
  return undefined;
};

/**
 * Build a flat {@link SemanticTree} from raw element rects (rounded to dp). When
 * the capture `frame` (the render viewport, in dp) is supplied it is stamped on
 * the root as `bounds`, so the diff engine can read the reference's coordinate
 * extent and normalise the candidate's render-pixel geometry into this dp space
 * (the two sides render at different densities). Omitting it leaves the root
 * unbounded, so the diff treats the trees as already sharing a space.
 */
export function treeFromRects(
  rects: RawRect[],
  frame?: { width: number; height: number },
): SemanticTree {
  const children: SemanticNode[] = rects.map((r) => ({
    label: r.label,
    ...(r.role ? { role: r.role } : {}),
    bounds: {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.w),
      height: Math.round(r.h),
    },
  }));
  const root: SemanticNode = { children };
  if (frame) root.bounds = { x: 0, y: 0, width: frame.width, height: frame.height };
  return { root };
}
