/**
 * Materialize a {@link Catalog} into an importable on-disk bundle.
 *
 * Layout written under `outDir`:
 *
 * ```
 * catalog.json            # the CatalogManifest index
 * tokens.dtcg.json        # the system token set, W3C DTCG (when present)
 * themes/<theme>.dtcg.json # one per alternate named theme (when declared)
 * figma-variables.json    # the Figma variable-collection projection (when present)
 * images/<component>/<variant>__<state>[__theme][__size].png
 * parity/known-differences.json          # the source repo's committed acceptances, verbatim
 * parity/known-differences/<id>/…        # their masks and accepted-candidate crops
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

import {
  buildAnnotationManifest,
  isEmptyAnnotationManifest,
} from "./annotations.js";
import {
  clearPublishedKnownDifferences,
  writeKnownDifferences,
  type KnownDifferencesResult,
} from "./knownDifferences.js";
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
  /**
   * Also carry the source repo's `.design-parity/known-differences*` into the bundle. Default
   * `true`.
   *
   * The escape hatch exists for a caller assembling a bundle from a directory that is not the
   * acceptances' repository — the only case where reading `.design-parity/` would carry someone
   * else's records. It is **not** an optimisation: skipping it makes every committed acceptance in
   * that bundle suppress nothing.
   */
  knownDifferences?: boolean;
  /**
   * Repository root the committed acceptances are read from. Default: `process.cwd()`.
   *
   * Deliberately **not** [sourceRoot]. That one is where a bundle's relative image URIs resolve —
   * the render output, routinely a temp dir or an unzipped artifact — while acceptances are
   * repository content committed beside `design-map.json`. Reusing `sourceRoot` here type-checks,
   * reads perfectly plausibly, and publishes nothing at all: `<renders>/.design-parity/` never
   * exists, so every committed acceptance would silently fail to reach the bundle.
   */
  knownDifferencesRoot?: string;
}

export interface WriteResult {
  /** Absolute path to the written `catalog.json`. */
  manifestPath: string;
  /** Absolute path to the DTCG token file, when tokens were exported. */
  tokensPath?: string;
  /**
   * Absolute path to each alternate theme's DTCG token file, in manifest order.
   * Absent when the system declares no alternate themes.
   */
  themeTokensPaths?: string[];
  /** Absolute path to the Figma variables file, when written. */
  figmaPath?: string;
  /** Number of image files written. */
  imageCount: number;
  /** Number of wireframe SVG files written. */
  wireframeCount?: number;
  /** Absolute path to the annotation manifest, when the catalog produced one. */
  annotationsPath?: string;
  /**
   * What the source repo's committed known differences produced, when it commits any.
   *
   * Present even when nothing was carried, so a caller can tell "this repo accepts nothing" from
   * "the acceptances were skipped" — `skipped` is the half worth reading, and a publisher that
   * dropped a mask without saying so would leave an acceptance suppressing nothing with nothing
   * anywhere explaining why.
   */
  knownDifferences?: KnownDifferencesResult;
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

  // One DTCG file per alternate theme, at the paths the manifest just named. The
  // system token set above keeps `figma-variables.json` to itself: that projection
  // is a single variable collection, and fanning it per theme is a variable-modes
  // question for the importer to answer, not one to guess at here.
  if (manifest.themes?.length) {
    const themesById = new Map((catalog.themes ?? []).map((t) => [t.id, t]));
    const paths: string[] = [];
    for (const entry of manifest.themes) {
      const theme = themesById.get(entry.id);
      if (!theme) continue;
      const path = join(out, entry.tokensFile);
      await writeJson(path, tokensToDtcg(theme.tokens), indent);
      paths.push(path);
    }
    if (paths.length > 0) result.themeTokensPaths = paths;
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

  // The annotation layer a preview server draws over its compare panels. Written
  // only when something would actually draw: an empty manifest is worse than none,
  // since a consumer would offer toggles that reveal nothing.
  const annotations = buildAnnotationManifest(catalog.components);
  if (!isEmptyAnnotationManifest(annotations)) {
    const annotationsPath = join(out, "annotations", "index.json");
    await mkdir(dirname(annotationsPath), { recursive: true });
    await writeJson(annotationsPath, annotations, indent);
    result.annotationsPath = annotationsPath;
  }

  // The source repo's committed parity acceptances, carried verbatim — see `knownDifferences.ts`
  // for why this module copies rather than parses, and for what publishing them on the render path
  // means for how soon an edit reaches a serving host.
  //
  // Unconditional rather than opt-in: an acceptance the repo committed and the bundle omits is an
  // acceptance that silently stops suppressing, which is the failure mode this whole contract is
  // built to avoid. A repo that commits none gets an empty result and no files.
  if (opts.knownDifferences === false) {
    // Disabled still clears. `outDir` is reused across renders, so a caller that carried
    // acceptances once and then turned the option off would otherwise publish a bundle still
    // containing them — acceptances that go on suppressing differences after being explicitly
    // switched off, visible only on the second render.
    await clearPublishedKnownDifferences(out);
  } else {
    result.knownDifferences = await writeKnownDifferences(out, {
      // NOT `sourceRoot` — see `knownDifferencesRoot`. Omitting it falls through to the reader's own
      // `process.cwd()` default, which is the repository for every caller that runs from one.
      repositoryRoot: opts.knownDifferencesRoot,
    });
  }

  return result;
}
