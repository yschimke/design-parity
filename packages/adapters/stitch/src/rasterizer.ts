/**
 * Headless rasterization of Stitch's HTML to a PNG. Like the candidate
 * renderer, this drives a tool already on `PATH` (headless Chrome/Chromium)
 * rather than bundling a browser-automation dependency. Injectable so unit
 * tests never launch a browser.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StitchRasterizeError } from "./errors.js";

/** What the adapter hands the rasterizer for one screen. */
export interface RasterizeInput {
  /** Stitch's generated markup. */
  html: string;
  /** Optional stylesheet to inline alongside the markup. */
  css?: string;
  /** Viewport hints; the default browser uses them for the window size. */
  width?: number;
  height?: number;
}

/** Turns one screen's HTML into PNG bytes. */
export interface Rasterizer {
  rasterize(input: RasterizeInput): Promise<Uint8Array>;
}

/** Chrome/Chromium binaries the default rasterizer probes, in order. */
const CHROME_BINS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
] as const;

function htmlDocument(input: RasterizeInput): string {
  const style = input.css ? `<style>${input.css}</style>` : "";
  // A bare reset so the captured frame matches the component box, not the
  // browser's default 8px body margin.
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>${style}</head><body>${input.html}</body></html>`;
}

/**
 * Drive a headless Chrome/Chromium found on `PATH` (or `CHROME_PATH`) to
 * screenshot the HTML. The browser is never bundled — absence is a clear error.
 */
export function browserRasterizer(
  env: Record<string, string | undefined> = process.env,
): Rasterizer {
  return {
    async rasterize(input: RasterizeInput): Promise<Uint8Array> {
      const bin = env.CHROME_PATH ?? CHROME_BINS[0];
      const dir = await mkdtemp(join(tmpdir(), "stitch-raster-"));
      const htmlPath = join(dir, "screen.html");
      const outPath = join(dir, "screen.png");
      try {
        await writeFile(htmlPath, htmlDocument(input), "utf8");
        const size =
          input.width && input.height
            ? [`--window-size=${input.width},${input.height}`]
            : [];
        await run(bin, [
          "--headless",
          "--disable-gpu",
          "--hide-scrollbars",
          "--default-background-color=00000000",
          ...size,
          `--screenshot=${outPath}`,
          `file://${htmlPath}`,
        ]);
        return new Uint8Array(await readFile(outPath));
      } catch (cause) {
        throw new StitchRasterizeError(
          `stitch: headless rasterization failed (is '${bin}' on PATH? set CHROME_PATH, or inject a Rasterizer)`,
          { cause },
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} exited with code ${code}`)),
    );
  });
}
