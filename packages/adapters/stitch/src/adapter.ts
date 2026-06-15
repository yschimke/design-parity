/**
 * The Stitch {@link ReferenceAdapter}: resolve a component to a Stitch design
 * via `design-map.json` (Stitch has no machine link), fetch HTML+Tailwind
 * through the SDK, rasterize a reference image headlessly, extract
 * Tailwind-derived tokens, and normalize to a {@link DesignReference}. The SDK
 * and the rasterizer are both injectable, so unit tests run with no live source.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  entryRefs,
  findByCode,
  loadDesignMap,
  type AdapterContext,
  type DesignReference,
  type Image,
  type ReferenceAdapter,
} from "@design-parity/core";

import { StitchManifestError } from "./errors.js";
import { normalizeReference } from "./normalize.js";
import { pngSize } from "./png.js";
import { browserRasterizer, type Rasterizer } from "./rasterizer.js";
import {
  createSdkStitchClient,
  type StitchClient,
} from "./stitch-client.js";
import {
  formatStitchRef,
  isStitchRef,
  parseStitchRef,
  type StitchRef,
} from "./stitch-ref.js";

export interface StitchAdapterOptions {
  /** Pre-built SDK client (tests inject a fake). Defaults to the SDK driver. */
  client?: StitchClient;
  /** HTML→PNG rasterizer (tests inject a fake). Defaults to headless Chrome. */
  rasterizer?: Rasterizer;
  /** Path to `design-map.json` when `ref` isn't a direct `stitch:` handle. */
  designMapPath?: string;
  /** Directory rasterized PNGs are written to. Defaults under the repo root. */
  outDir?: string;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class StitchAdapter implements ReferenceAdapter {
  readonly source = "stitch" as const;
  readonly #opts: StitchAdapterOptions;

  constructor(opts: StitchAdapterOptions = {}) {
    this.#opts = opts;
  }

  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const stitchRef = await this.#resolveRef(componentId, ref, ctx);
    const client = this.#opts.client ?? createSdkStitchClient(ctx.env);
    const design = await client.fetchDesign(stitchRef);

    const rasterizer = this.#opts.rasterizer ?? browserRasterizer(ctx.env);
    const outDir =
      this.#opts.outDir ?? join(ctx.repoRoot, ".design-parity", "cache", "stitch");
    await mkdir(outDir, { recursive: true });

    const referenceImages: Image[] = [];
    for (const screen of design.screens) {
      const rasterizeArgs: Parameters<Rasterizer["rasterize"]>[0] = {
        html: screen.html,
      };
      if (screen.css !== undefined) rasterizeArgs.css = screen.css;
      const bytes = await rasterizer.rasterize(rasterizeArgs);
      const { width, height } = pngSize(bytes);

      const file = join(
        outDir,
        `${slug(componentId)}--${screen.theme ?? screen.state ?? "default"}--${screen.size ?? "default"}.png`,
      );
      await writeFile(file, bytes);

      const image: Image = {
        state: screen.state ?? "default",
        uri: file,
        width,
        height,
      };
      if (screen.theme) image.theme = screen.theme;
      if (screen.size) image.size = screen.size;
      referenceImages.push(image);
    }

    return normalizeReference({
      componentId,
      ref: formatStitchRef(stitchRef),
      design,
      referenceImages,
    });
  }

  /**
   * Resolve the Stitch handle. A direct `stitch:` ref is parsed as-is;
   * otherwise the `design-map.json` manifest is the only correspondence layer.
   */
  async #resolveRef(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<StitchRef> {
    if (isStitchRef(ref)) return parseStitchRef(ref);

    const path =
      this.#opts.designMapPath ??
      ctx.env.DESIGN_MAP_FILE ??
      join(ctx.repoRoot, "design-map.json");

    let map;
    try {
      map = await loadDesignMap(path);
    } catch (cause) {
      throw new StitchManifestError(
        componentId,
        `cannot load design-map at '${path}'`,
        { cause },
      );
    }

    const entry = findByCode(map, componentId);
    if (!entry) {
      throw new StitchManifestError(componentId, `no matching entry in '${path}'`);
    }
    if (entry.source !== "stitch") {
      throw new StitchManifestError(
        componentId,
        `maps to source '${entry.source}', not 'stitch'`,
      );
    }
    // The manifest fallback resolves to the primary node; multi-node bindings
    // are merged upstream, so a direct adapter call uses the structure node.
    return parseStitchRef(entryRefs(entry)[0]!.ref);
  }
}

/** Convenience factory. */
export function createStitchAdapter(
  opts: StitchAdapterOptions = {},
): StitchAdapter {
  return new StitchAdapter(opts);
}
