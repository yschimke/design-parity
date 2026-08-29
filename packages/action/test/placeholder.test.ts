import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

import {
  FigmaRestClient,
  type FetchLike,
  type ReferenceCacheEntry,
} from "@design-parity/adapter-figma";

import { importReferences, refreshOrder } from "../src/import.js";
import { NO_PLACEHOLDER, isCheckerboard, normalisePlaceholders } from "../src/placeholder.js";

/**
 * A checkerboard tile, with the grid offset by `phase` pixels on both axes.
 *
 * Figma's own placeholder is offset — its bands break at 26px then every 50px
 * in a 400px image — so a detector that assumed the grid starts at the tile's
 * corner would miss the one asset this exists for.
 */
function checkerTile(size: number, pitch: number, phase = 0, a = 0xff, b = 0xd9): PNG {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = Math.floor((x - phase) / pitch);
      const row = Math.floor((y - phase) / pitch);
      const v = (row + col) % 2 === 0 ? a : b;
      const i = (y * size + x) * 4;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

const dataUri = (png: PNG) => PNG.sync.write(png).toString("base64");

/** A Figma-shaped SVG: a path fills from a pattern that wraps a tiled image. */
function svgWith(png: PNG, size = 400): string {
  return [
    '<svg width="172" height="52" viewBox="0 0 172 52" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<path d="M0 26C0 11.6 11.6 0 26 0H172V52H26C11.6 52 0 40.4 0 26Z" fill="url(#pattern0_1)"/>',
    "<defs>",
    '<pattern id="pattern0_1" patternContentUnits="objectBoundingBox" width="1" height="1">',
    '<use xlink:href="#image0_1" transform="matrix(0.0025 0 0 0.00826923 0 -1.15385)"/>',
    "</pattern>",
    `<image id="image0_1" width="${size}" height="${size}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${dataUri(png)}"/>`,
    "</defs>",
    "</svg>",
  ].join("\n");
}

describe("isCheckerboard", () => {
  it("accepts a grid whose origin sits outside the tile, as Figma's does", () => {
    // 400px, 50px pitch, bands breaking at 26 — the kit's actual geometry.
    expect(isCheckerboard(checkerTile(400, 50, 26))?.colors).toEqual(["#ffffff", "#d9d9d9"]);
  });

  it("rejects vertical stripes, which are two colours in regular bands but do not alternate", () => {
    const png = new PNG({ width: 64, height: 64 });
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = Math.floor(x / 8) % 2 === 0 ? 0xff : 0xd9;
        const i = (y * 64 + x) * 4;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
        png.data[i + 3] = 255;
      }
    }
    expect(isCheckerboard(png)).toBeNull();
  });

  it("rejects a two-colour image that is not a grid at all", () => {
    const png = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < png.data.length; i += 4) {
      const v = i % 7 === 0 ? 0x00 : 0xff;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
    expect(isCheckerboard(png)).toBeNull();
  });

  it("rejects a three-colour tile, so real artwork is never normalised away", () => {
    const png = checkerTile(64, 8);
    png.data[0] = 0x12;
    png.data[1] = 0x34;
    png.data[2] = 0x56;
    expect(isCheckerboard(png)).toBeNull();
  });

  it("rejects a translucent tile", () => {
    const png = checkerTile(64, 8);
    png.data[3] = 0;
    expect(isCheckerboard(png)).toBeNull();
  });

  it("rejects a tile with too few bands to be a pattern", () => {
    expect(isCheckerboard(checkerTile(64, 32))).toBeNull();
  });
});

describe("normalisePlaceholders", () => {
  const svg = svgWith(checkerTile(400, 50, 26));

  it("paints the mean of the tile's two colours by default", () => {
    const { svg: out, rewrites } = normalisePlaceholders(svg, "flat");
    expect(out).toContain('fill="#ececec"');
    expect(out).not.toContain("url(#pattern0_1)");
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]).toMatchObject({
      imageId: "image0_1",
      patternIds: ["pattern0_1"],
      colors: ["#ffffff", "#d9d9d9"],
      paint: "#ececec",
    });
    expect(rewrites[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the path untouched, so the geometry is still compared", () => {
    const { svg: out } = normalisePlaceholders(svg, "flat");
    expect(out).toContain('d="M0 26C0 11.6 11.6 0 26 0H172V52H26C11.6 52 0 40.4 0 26Z"');
    expect(out).toContain('width="172" height="52"');
  });

  it("drops the tile it no longer paints with", () => {
    const { svg: out } = normalisePlaceholders(svg, "flat");
    expect(out).not.toContain("data:image/png;base64,");
    expect(out).not.toContain("<pattern");
    expect(out.length).toBeLessThan(svg.length / 2);
  });

  it("paints none for transparent", () => {
    const { svg: out } = normalisePlaceholders(svg, "transparent");
    expect(out).toContain('fill="none"');
  });

  it("takes an explicit colour", () => {
    const { svg: out, rewrites } = normalisePlaceholders(svg, "#ff00ff80");
    expect(out).toContain('fill="#ff00ff80"');
    expect(rewrites[0]!.paint).toBe("#ff00ff80");
  });

  it("returns the document untouched for checkerboard", () => {
    const { svg: out, rewrites } = normalisePlaceholders(svg, "checkerboard");
    expect(out).toBe(svg);
    expect(rewrites).toEqual([]);
  });

  it("leaves a document with real artwork alone", () => {
    const art = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < art.data.length; i += 4) {
      art.data[i] = i % 255;
      art.data[i + 1] = 0x40;
      art.data[i + 2] = 0x80;
      art.data[i + 3] = 255;
    }
    const withArt = svgWith(art, 64);
    const { svg: out, rewrites } = normalisePlaceholders(withArt, "flat");
    expect(out).toBe(withArt);
    expect(rewrites).toEqual([]);
  });
});

/**
 * The unit tests above prove the rewrite; these prove it is actually reached.
 * A normaliser wired to nothing passes every test in the block above.
 */
describe("importReferences, placeholder normalisation", () => {
  const tile = checkerTile(400, 50, 26);
  const placeholderSvg = svgWith(tile);
  let served = placeholderSvg;

  const fakeFigma = (): FetchLike => async (url) => {
    if (url.includes("?depth=1")) {
      return new Response(JSON.stringify({ name: "Kit", version: "v1" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/variables/local")) {
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/nodes?")) {
      const ids = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "").split(",");
      const nodes: Record<string, unknown> = {};
      for (const id of ids) {
        nodes[id] = {
          document: {
            id,
            name: `Node ${id}`,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 172, height: 52 },
          },
        };
      }
      return new Response(JSON.stringify({ nodes }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/images/")) {
      const ids = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "").split(",");
      const images: Record<string, string> = {};
      for (const id of ids) images[id] = `https://img.test/${id}.svg`;
      return new Response(JSON.stringify({ err: null, images }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(served);
  };

  const plainSvg =
    '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="10" height="10" fill="#123456"/></svg>';

  async function runImport(placeholderFill?: "flat" | "checkerboard", document?: string) {
    served = document ?? placeholderSvg;
    const cacheDir = await mkdtemp(join(tmpdir(), "dp-placeholder-"));
    const result = await importReferences({
      cacheDir,
      refs: ["figma:AbCdEf123456/1:2"],
      client: new FigmaRestClient({
        token: "tok",
        baseUrl: "https://api.test",
        fetch: fakeFigma(),
        attempts: 1,
      }),
      ...(placeholderFill ? { placeholderFill } : {}),
    });
    const cached = await readFile(join(cacheDir, "AbCdEf123456", "1-2", "image.svg"), "utf8");
    const index = JSON.parse(await readFile(join(cacheDir, "index.json"), "utf8"));
    return { result, cached, index };
  }

  it("normalises by default, and says so in the count", async () => {
    const { result, cached } = await runImport();
    expect(result.refreshed).toBe(1);
    expect(result.placeholders).toBe(1);
    expect(cached).toContain('fill="#ececec"');
    expect(cached).not.toContain("data:image/png;base64,");
  });

  it("records the mode on a node that has a placeholder", async () => {
    const { index } = await runImport();
    expect(index.entries[0].imagePlaceholderFill).toBe("flat");
  });

  it("records no-placeholder on a node that has none, so a mode switch skips it", async () => {
    const { index } = await runImport(undefined, plainSvg);
    expect(index.entries[0].imagePlaceholderFill).toBe(NO_PLACEHOLDER);
  });

  it("caches Figma's own output when asked for checkerboard", async () => {
    const { result, cached } = await runImport("checkerboard");
    expect(result.placeholders).toBe(0);
    expect(cached).toContain("data:image/png;base64,");
    expect(cached).toContain("url(#pattern0_1)");
  });
});

/**
 * The mode is applied at download, so it only reaches nodes the import decides
 * to re-read. Without the mode in that decision, an existing cache keeps its
 * checkerboards forever and the default is silently inert (issue #436).
 */
describe("refreshOrder, placeholder mode", () => {
  const entry = (fill?: string): ReferenceCacheEntry => ({
    fileKey: "F",
    nodeId: "1:2",
    fileVersion: "v1",
    fetchedAt: "2026-01-01T00:00:00Z",
    node: "F/1-2/node.json",
    image: "F/1-2/image.svg",
    imageFormat: "svg",
    imageContentsOnly: true,
    ...(fill ? { imagePlaceholderFill: fill } : {}),
  });

  it("re-reads a node cached under a different mode, with the file unmoved", () => {
    expect(refreshOrder(["1:2"], () => entry("checkerboard"), "v1", false, true, "flat")).toEqual([
      "1:2",
    ]);
  });

  it("treats an entry written before the option existed as a checkerboard", () => {
    expect(refreshOrder(["1:2"], () => entry(), "v1", false, true, "flat")).toEqual(["1:2"]);
    expect(refreshOrder(["1:2"], () => entry(), "v1", false, true, "checkerboard")).toEqual([]);
  });

  it("leaves a node already cached under the wanted mode alone", () => {
    expect(refreshOrder(["1:2"], () => entry("flat"), "v1", false, true, "flat")).toEqual([]);
  });

  it("never re-reads an entry a scan found no placeholder in, under any mode", () => {
    // The whole point: 549 of the kit's 581 nodes have nothing a mode can
    // change, and re-fetching them to rewrite them byte-identically is what
    // this marker exists to stop.
    for (const mode of ["flat", "checkerboard", "transparent", "#ff00ff"] as const) {
      expect(
        refreshOrder(["1:2"], () => entry(NO_PLACEHOLDER), "v1", false, true, mode),
      ).toEqual([]);
    }
  });

  it("re-reads a PNG entry when the import asks for SVG, whatever the mode says", () => {
    // `imageFormat` was recorded but never compared, so a cache built with
    // `--format png` stayed PNG under a later `--format svg`. A differing mode
    // used to refresh those rows as a side effect; NO_PLACEHOLDER correctly
    // stops that, which is what surfaced the real gap underneath.
    const png: ReferenceCacheEntry = {
      ...entry(NO_PLACEHOLDER),
      image: "F/1-2/image.png",
      imageFormat: "png",
    };
    expect(refreshOrder(["1:2"], () => png, "v1", false, true, "flat", "svg")).toEqual(["1:2"]);
    expect(refreshOrder(["1:2"], () => png, "v1", false, true, "flat", "png")).toEqual([]);
  });

  it("re-reads an entry rendered at a different scale, whatever the mode says", () => {
    // Scale is sent to Figma at render time and was never persisted, so nothing
    // could compare it. Same class as the format gap, and the last member of it:
    // a no-placeholder entry still has pixels, and they are still the wrong size.
    const at1: ReferenceCacheEntry = { ...entry(NO_PLACEHOLDER), imageScale: 1 };
    expect(refreshOrder(["1:2"], () => at1, "v1", false, true, "flat", "svg", 2)).toEqual(["1:2"]);
    expect(refreshOrder(["1:2"], () => at1, "v1", false, true, "flat", "svg", 1)).toEqual([]);
  });

  it("treats an entry with no recorded scale as the API default of 1", () => {
    expect(refreshOrder(["1:2"], () => entry(NO_PLACEHOLDER), "v1", false, true, "flat", "svg", 1)).toEqual(
      [],
    );
    expect(refreshOrder(["1:2"], () => entry(NO_PLACEHOLDER), "v1", false, true, "flat", "svg", 2)).toEqual(
      ["1:2"],
    );
  });

  it("does not sweep a cache that is staying on checkerboard", () => {
    // An entry written before normalisation existed is verbatim Figma output,
    // and verbatim IS the checkerboard — so it is already what `checkerboard`
    // asks for and re-reading it would buy nothing. Switching AWAY from
    // checkerboard still re-reads it (the case above), which is right, because
    // presence is unknown on an entry nothing has scanned.
    expect(refreshOrder(["1:2"], () => entry(), "v1", false, true, "checkerboard")).toEqual([]);
  });

  it("still re-reads a node whose recorded mode differs", () => {
    expect(refreshOrder(["1:2"], () => entry("checkerboard"), "v1", false, true, "flat")).toEqual([
      "1:2",
    ]);
  });
});
