/**
 * Headless rasterization of an HTML export into a PNG.
 *
 * Rasterization is pluggable so unit tests stay deterministic and the package
 * keeps a single runtime dependency (`@design-parity/core`): the default
 * {@link browserRasterizer} shells out to a headless Chrome/Chromium already on
 * PATH rather than bundling a browser automation library. Callers that render
 * inside an existing harness (Playwright, a hosted renderer) inject their own.
 */
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { Theme } from "@design-parity/core";

const execFileAsync = promisify(execFile);

/** A request to rasterize one variant of an HTML export. */
export interface RasterRequest {
  /** Absolute path to the HTML export to render. */
  htmlPath: string;
  /** Variant state, e.g. `"default"`. */
  state: string;
  theme?: Theme;
  size?: string;
}

/** The product of rasterization: an absolute PNG path and its dimensions. */
export interface RasterResult {
  /** Absolute path to the written PNG. */
  pngPath: string;
  width: number;
  height: number;
}

/** Renders an HTML export variant to a PNG on disk. */
export type Rasterizer = (req: RasterRequest) => Promise<RasterResult>;

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
 * Default rasterizer: drives a headless Chrome/Chromium via `--screenshot`.
 *
 * It writes the PNG into a fresh temp directory and reads back its dimensions.
 * Never invoked by the adapter for exports that ship pre-rendered `src` images;
 * only raw exports (or `src`-less variants) reach it.
 *
 * @throws a clear, actionable error if no Chrome/Chromium binary is found.
 */
export const browserRasterizer: Rasterizer = async (req) => {
  const { parsePngSize } = await import("./png.js");
  const { readFile } = await import("node:fs/promises");

  const outDir = await mkdtemp(join(tmpdir(), "design-parity-claude-"));
  const pngPath = join(outDir, `${req.state}.png`);
  const url = pathToFileURL(req.htmlPath).href;

  let lastErr: unknown;
  for (const bin of CHROME_CANDIDATES) {
    try {
      await execFileAsync(bin, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--screenshot=${pngPath}`,
        url,
      ]);
      const { width, height } = parsePngSize(await readFile(pngPath), pngPath);
      return { pngPath, width, height };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    "claude-design: headless rasterization needs Chrome/Chromium on PATH " +
      "(set CHROME_BIN), or pass a custom `rasterizer` to the adapter. " +
      `Tried: ${CHROME_CANDIDATES.join(", ") || "<none>"}.`,
    { cause: lastErr },
  );
};
