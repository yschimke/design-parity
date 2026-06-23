import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeCatalog } from "../src/write.js";
import type { Catalog } from "../src/types.js";

// A 1x1 transparent PNG, base64 — bytes are opaque to the writer.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URI = `data:image/png;base64,${PNG_B64}`;

let out: string;
let src: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "catalog-out-"));
  src = await mkdtemp(join(tmpdir(), "catalog-src-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
  await rm(src, { recursive: true, force: true });
});

function catalogWith(idealUri: string, layoutUri: string): Catalog {
  return {
    meta: { system: "compose-m3", title: "Compose Material 3" },
    themeTokens: { colors: { "primary.light": "#fff", "primary.dark": "#000" }, radius: { sm: 8 } },
    components: [
      {
        componentId: "Button/Filled",
        variants: {
          ideal: [{ state: "default", theme: "light", uri: idealUri, width: 1, height: 1 }],
          layout: [{ state: "default", theme: "light", uri: layoutUri, width: 1, height: 1 }],
        },
        greenlines: [],
      },
    ],
  };
}

describe("writeCatalog", () => {
  it("writes manifest, DTCG tokens, figma variables, and image bytes from data URIs", async () => {
    const result = await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out);

    expect(result.imageCount).toBe(2);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(manifest.schema).toBe("design-parity-catalog/v1");
    expect(manifest.tokensFile).toBe("tokens.dtcg.json");

    const dtcg = JSON.parse(await readFile(result.tokensPath!, "utf8"));
    expect(dtcg.color["primary.light"].$value).toBe("#fff");
    expect(dtcg.radius.sm.$value).toBe(8);

    const figma = JSON.parse(await readFile(result.figmaPath!, "utf8"));
    expect(Object.keys(figma.modes).sort()).toEqual(["dark", "light"]);

    const png = await readFile(join(out, "images/button-filled/ideal__default__light.png"));
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("resolves relative image paths against sourceRoot", async () => {
    await mkdir(join(src, "renders"), { recursive: true });
    await writeFile(join(src, "renders/i.png"), Buffer.from(PNG_B64, "base64"));
    await writeFile(join(src, "renders/w.png"), Buffer.from(PNG_B64, "base64"));

    const result = await writeCatalog(
      catalogWith("renders/i.png", "renders/w.png"),
      out,
      { sourceRoot: src },
    );
    expect(result.imageCount).toBe(2);
    const png = await readFile(join(out, "images/button-filled/layout__default__light.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("skips token/figma files when the catalog has no themeTokens", async () => {
    const catalog: Catalog = {
      meta: { system: "x", title: "X" },
      components: [
        { componentId: "A", variants: { ideal: [{ state: "default", uri: PNG_DATA_URI, width: 1, height: 1 }] }, greenlines: [] },
      ],
    };
    const result = await writeCatalog(catalog, out, { figmaVariables: true });
    expect(result.tokensPath).toBeUndefined();
    expect(result.figmaPath).toBeUndefined();
    expect(result.imageCount).toBe(1);
  });
});
