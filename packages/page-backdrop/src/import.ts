/**
 * The import run: key pages in, committed manifest + backdrop images out.
 *
 * Deliberately a one-shot, human-invoked step rather than anything the PR bot
 * does per run. Importing touches a live design tool and rewrites committed
 * files, so it belongs in a deliberate "refresh the backdrops" commit that a
 * reviewer can see, not in a check that fires on every push.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PageBackdropConfig } from "./config.js";
import { slugify } from "./config.js";
import type { PageFetcher } from "./fetcher.js";
import { collectInstances, frameSize } from "./instances.js";
import { linkInstances, type LinkInputs } from "./link.js";
import { assertAddressableSvg } from "./svg-backdrop.js";
import type { BackdropImage, BackdropPage, PageBackdropManifest } from "./types.js";
import { PAGE_BACKDROP_VERSION } from "./types.js";

/** What an import produced, before anything touches the filesystem. */
export interface ImportResult {
  manifest: PageBackdropManifest;
  /** Backdrop PNG bytes, keyed by the page id they belong to. */
  images: Map<string, Uint8Array>;
  /** Non-fatal diagnostics from linking. */
  warnings: string[];
}

export interface ImportOptions {
  config: PageBackdropConfig;
  fetcher: PageFetcher;
  /** Committed correspondence inputs. Without them every placement is unlinked. */
  inputs?: LinkInputs;
}

/**
 * Make `id` unique within `taken`, appending `-2`, `-3`, … on collision. Two
 * frames may legitimately share a name ("Settings" in two flows); the manifest
 * still needs one file per page.
 */
function uniqueId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) {
    taken.add(id);
    return id;
  }
  for (let n = 2; ; n++) {
    const candidate = `${id}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * Export one page's backdrop, in whichever format the config asked for.
 *
 * The SVG path validates before it returns anything. An export that came back
 * without ids still renders as a perfectly good picture, so nothing downstream
 * would report it — every placement would just quietly fail to find its element,
 * and the viewer would look like it worked. A repo that asked for an addressable
 * backdrop and got a picture should hear about it here, once, rather than never.
 */
async function exportBackdrop(
  fetcher: PageFetcher,
  config: PageBackdropConfig,
  nodeId: string,
  id: string,
): Promise<{ bytes: Uint8Array; meta: BackdropImage }> {
  if (config.backdrop === "svg") {
    if (!fetcher.renderPageSvg) {
      throw new Error(
        "page-backdrop: this source cannot export an addressable SVG; set 'backdrop' to 'png'",
      );
    }
    const svg = await fetcher.renderPageSvg(config.fileKey, nodeId);
    assertAddressableSvg(svg, nodeId);
    return {
      bytes: new TextEncoder().encode(svg),
      // `scale` is carried unchanged and means nothing here: a vector has no
      // raster size. Dropping it would make the field conditional for every
      // reader of the manifest, to save four bytes.
      meta: { uri: `${id}.svg`, scale: config.scale, format: "svg" },
    };
  }

  const png = await fetcher.renderPage(config.fileKey, nodeId, config.scale);
  return { bytes: png, meta: { uri: `${id}.png`, scale: config.scale, format: "png" } };
}

/**
 * Import every page named in the config.
 *
 * Pages are fetched in the order the config lists them, so the manifest's page
 * order is the repo's own stated priority — the "key pages", in the order
 * someone decided they mattered.
 */
export async function importPages({
  config,
  fetcher,
  inputs,
}: ImportOptions): Promise<ImportResult> {
  const pages: BackdropPage[] = [];
  const images = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const taken = new Set<string>();

  for (const selector of config.pages) {
    const doc = await fetcher.fetchPage(config.fileKey, selector.nodeId);
    const id = uniqueId(selector.id ?? slugify(doc.document.name), taken);

    const hits = collectInstances(doc, { nested: config.nested });
    const linked = linkInstances(hits, config.fileKey, inputs);
    warnings.push(...linked.warnings);

    const image = await exportBackdrop(fetcher, config, selector.nodeId, id);
    images.set(id, image.bytes);

    pages.push({
      id,
      name: doc.document.name,
      nodeId: selector.nodeId,
      frame: frameSize(doc),
      image: image.meta,
      placements: linked.placements,
    });
  }

  return {
    manifest: {
      version: PAGE_BACKDROP_VERSION,
      source: "figma",
      fileKey: config.fileKey,
      pages,
    },
    images,
    warnings,
  };
}

/** Filename of the manifest inside the output directory. */
export const MANIFEST_FILENAME = "pages.json";

/**
 * Write an import to `outDir` — `pages.json` plus one PNG per page.
 *
 * The JSON is pretty-printed with a trailing newline so a re-import produces a
 * readable, reviewable diff rather than one enormous changed line.
 */
export async function writeImport(
  result: ImportResult,
  outDir: string,
): Promise<{ manifestPath: string; imagePaths: string[] }> {
  await mkdir(outDir, { recursive: true });

  const manifestPath = join(outDir, MANIFEST_FILENAME);
  await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");

  const imagePaths: string[] = [];
  for (const page of result.manifest.pages) {
    const bytes = result.images.get(page.id);
    if (!bytes) continue;
    const path = join(outDir, page.image.uri);
    await writeFile(path, bytes);
    imagePaths.push(path);
  }

  return { manifestPath, imagePaths };
}

/** Read a manifest back, with the shape checks a hand-edited file warrants. */
export function parseManifest(raw: unknown): PageBackdropManifest {
  const m = raw as Partial<PageBackdropManifest> | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.pages)) {
    throw new Error("page-backdrop: manifest is not a page-backdrop manifest");
  }
  if (m.version !== PAGE_BACKDROP_VERSION) {
    throw new Error(
      `page-backdrop: manifest version ${String(m.version)} is not supported (expected ${PAGE_BACKDROP_VERSION})`,
    );
  }
  return m as PageBackdropManifest;
}
