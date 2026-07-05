/**
 * Materialize a {@link Catalog} into an importable on-disk bundle.
 *
 * Layout written under `outDir`:
 *
 * ```
 * catalog.json            # the CatalogManifest index
 * tokens.dtcg.json        # the system token set, W3C DTCG (when present)
 * figma-variables.json    # the Figma variable-collection projection (when present)
 * images/<component>/<variant>__<state>[__theme][__size].png
 * ```
 *
 * Image bytes are resolved from each {@link Image.uri}: a `data:` URI is decoded
 * inline; any other value is read as a path (absolute, or relative to
 * `sourceRoot`). This is the only module in the package that does I/O — the
 * manifest, token, and Figma projections it writes are all built by the pure
 * functions in the sibling modules.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { tokensToDtcg } from "@design-parity/core";
import type { Image } from "@design-parity/core";

import { toFigmaVariables } from "./figma.js";
import { imagePath, toCatalogManifest, wireframePath, type ManifestOptions } from "./manifest.js";
import type { Catalog } from "./types.js";

export interface WriteOptions extends ManifestOptions {
  /** Root that relative image `uri`s resolve against. Default: `process.cwd()`. */
  sourceRoot?: string;
  /** Also emit the Figma variable-collection projection. Default `true`. */
  figmaVariables?: boolean;
  /** Pretty-print JSON with this indent. Default `2`. */
  indent?: number;
}

export interface WriteResult {
  /** Absolute path to the written `catalog.json`. */
  manifestPath: string;
  /** Absolute path to the DTCG token file, when tokens were exported. */
  tokensPath?: string;
  /** Absolute path to the Figma variables file, when written. */
  figmaPath?: string;
  /** Number of image files written. */
  imageCount: number;
  /** Number of wireframe SVG files written. */
  wireframeCount?: number;
}

const DATA_URI = /^data:([^;,]*)?(;base64)?,(.*)$/s;

/** Resolve the bytes for an {@link Image}: inline `data:` URI or a file path. */
async function imageBytes(image: Image, sourceRoot: string): Promise<Buffer> {
  const match = DATA_URI.exec(image.uri);
  if (match) {
    const isBase64 = match[2] === ";base64";
    const data = match[3] ?? "";
    return isBase64
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8");
  }
  const path = isAbsolute(image.uri) ? image.uri : resolve(sourceRoot, image.uri);
  return readFile(path);
}

async function writeJson(
  path: string,
  value: unknown,
  indent: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, indent)}\n`, "utf8");
}

/** Write the full importable catalog bundle to `outDir`. */
export async function writeCatalog(
  catalog: Catalog,
  outDir: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const sourceRoot = opts.sourceRoot ?? process.cwd();
  const indent = opts.indent ?? 2;
  const out = resolve(outDir);
  await mkdir(out, { recursive: true });

  const manifest = toCatalogManifest(catalog, opts);
  const manifestPath = join(out, "catalog.json");
  await writeJson(manifestPath, manifest, indent);

  const result: WriteResult = { manifestPath, imageCount: 0 };

  if (catalog.themeTokens && manifest.tokensFile) {
    const tokensPath = join(out, manifest.tokensFile);
    await writeJson(tokensPath, tokensToDtcg(catalog.themeTokens), indent);
    result.tokensPath = tokensPath;

    if (opts.figmaVariables !== false) {
      const figmaPath = join(out, "figma-variables.json");
      await writeJson(
        figmaPath,
        toFigmaVariables(catalog.themeTokens, catalog.meta.title),
        indent,
      );
      result.figmaPath = figmaPath;
    }
  }

  // Image bytes, keyed by the same paths the manifest computed.
  for (const component of catalog.components) {
    const variants: Array<["ideal" | "layout", Image[] | undefined]> = [
      ["ideal", component.variants.ideal],
      ["layout", component.variants.layout],
    ];
    for (const [variant, images] of variants) {
      for (const image of images ?? []) {
        const rel = imagePath(component.componentId, variant, image);
        const dest = join(out, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await imageBytes(image, sourceRoot));
        result.imageCount += 1;
      }
    }

    // The pre-generated wireframe SVG (schematic), baked beside the images so the
    // importer only fetches + places it.
    if (component.wireframeSvg !== undefined) {
      const dest = join(out, wireframePath(component.componentId));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, component.wireframeSvg, "utf8");
      result.wireframeCount = (result.wireframeCount ?? 0) + 1;
    }
  }

  return result;
}
