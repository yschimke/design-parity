/**
 * Live-render a Claude Design prototype into per-viewport PNGs.
 *
 * The static path ({@link ./rasterizer.ts}) captures a committed HTML export as a
 * single frame. Live-render instead drives the actual clickable prototype in a
 * real browser and captures it at **several viewports**, so the reference can be
 * matched per-cell against the candidate's render matrix (device × breakpoint)
 * rather than one fixed frame — a truer reference that also picks up whatever the
 * flattened static export drops (issue #85).
 *
 * Rendering is pluggable, exactly like the rasterizer: the package keeps a single
 * runtime dependency (`@design-parity/core`), the default {@link browserLiveRenderer}
 * shells out to a headless Chrome/Chromium already on PATH, and a caller running
 * inside an existing harness (Playwright, a hosted renderer) injects its own
 * {@link LiveRenderer}. Either way the adapter normalizes the output to the same
 * {@link DesignReference} contract, so the diff engine never sees the difference.
 */
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { Theme } from "@design-parity/core";

const execFileAsync = promisify(execFile);

/** One breakpoint to capture the prototype at. */
export interface LiveViewport {
  /**
   * Breakpoint label recorded on the resulting {@link Image} as its `size`, e.g.
   * `"compact"` / `"medium"` / `"expanded"`. Keys the reference frame against the
   * candidate's matching per-size render.
   */
  size: string;
  /** CSS-pixel width to drive the prototype at. */
  width: number;
  /**
   * CSS-pixel height that seeds the browser window; the capture reads the PNG's
   * intrinsic size back, so a full-page render taller than this still records its
   * true height. Defaults to {@link DEFAULT_VIEWPORT_HEIGHT}.
   */
  height?: number;
}

/** A request to live-render one viewport of a prototype. */
export interface LiveRenderRequest {
  /**
   * Absolute path to the prototype to drive — a clickable Claude Design HTML
   * export (or a built prototype entry point). Rendered via a `file://` URL.
   */
  prototypePath: string;
  viewport: LiveViewport;
  /** The theme the prototype should render under, when it honours one. */
  theme?: Theme;
}

/** The product of a live render: an absolute PNG path and its intrinsic size. */
export interface LiveRenderResult {
  /** Absolute path to the written PNG. */
  pngPath: string;
  width: number;
  height: number;
}

/** Drives a prototype and captures one viewport to a PNG on disk. */
export type LiveRenderer = (req: LiveRenderRequest) => Promise<LiveRenderResult>;

/** Fallback window height (px) when a viewport doesn't pin one. */
export const DEFAULT_VIEWPORT_HEIGHT = 915;

/**
 * The viewports the adapter captures when a live ref doesn't configure its own.
 * A single compact frame — the lighter default; callers opt into a wider matrix
 * by passing `liveViewports`.
 */
export const DEFAULT_LIVE_VIEWPORTS: LiveViewport[] = [
  { size: "compact", width: 412, height: DEFAULT_VIEWPORT_HEIGHT },
];

/** Chrome/Chromium binaries we probe, in order of preference. */
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "chrome",
].filter((c): c is string => typeof c === "string" && c.length > 0);

/**
 * Default live renderer: drives the prototype in a headless Chrome/Chromium sized
 * to the viewport and captures it via `--screenshot`.
 *
 * Writes the PNG into a fresh temp directory and reads back its intrinsic
 * dimensions from the bytes (never a caller-supplied size). A caller that already
 * runs Playwright injects that instead of this.
 *
 * @throws a clear, actionable error if no Chrome/Chromium binary is found.
 */
export const browserLiveRenderer: LiveRenderer = async (req) => {
  const { parsePngSize } = await import("./png.js");
  const { readFile } = await import("node:fs/promises");

  const outDir = await mkdtemp(join(tmpdir(), "design-parity-claude-live-"));
  const { width, height = DEFAULT_VIEWPORT_HEIGHT } = req.viewport;
  const pngPath = join(outDir, `${req.viewport.size}.png`);
  const url = pathToFileURL(req.prototypePath).href;

  let lastErr: unknown;
  for (const bin of CHROME_CANDIDATES) {
    try {
      await execFileAsync(bin, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${width},${height}`,
        `--screenshot=${pngPath}`,
        url,
      ]);
      const size = parsePngSize(await readFile(pngPath), pngPath);
      return { pngPath, width: size.width, height: size.height };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    "claude-design: live-render needs Chrome/Chromium on PATH " +
      "(set CHROME_BIN), or pass a custom `liveRenderer` to the adapter. " +
      `Tried: ${CHROME_CANDIDATES.join(", ") || "<none>"}.`,
    { cause: lastErr },
  );
};
