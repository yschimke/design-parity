/**
 * The Claude Design reference adapter.
 *
 * Claude Design (beta since 2026-06) exposes **no read API and no Figma
 * export**, so unlike the Figma adapter there is nothing to fetch at run time.
 * The reference is a committed HTML export, linked from the repo's
 * `design-map.json` by a repo-relative path. (Claude Code's `/design-sync` can
 * now emit those committed artifacts, but it is a governed read->plan->write
 * skill, not an API this adapter calls -- see docs/claude-design-sync-impact.md.)
 * This adapter:
 *
 *   1. resolves that path against the consumer repo root,
 *   2. parses the export's embedded handoff manifest (tokens + image variants),
 *   3. rasterizes any variant that ships as raw HTML headlessly, and
 *   4. normalizes everything to a {@link DesignReference} with
 *      `linkMethod: "manifest"` — the only link method possible for a source
 *      with no machine link.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type {
  AdapterContext,
  DesignReference,
  DesignTokens,
  Image,
  ReferenceAdapter,
} from "@design-parity/core";

import { parseHandoff, type HandoffManifest } from "./html-export.js";
import { readPngSize } from "./png.js";
import { browserRasterizer, type Rasterizer } from "./rasterizer.js";
import {
  puppeteerLayoutExtractor,
  type LayoutExtractor,
} from "./layout-extractor.js";

export interface ClaudeDesignAdapterOptions {
  /**
   * How to rasterize raw HTML variants. Defaults to {@link browserRasterizer}
   * (headless Chrome/Chromium). Exports that ship pre-rendered `src` images
   * never invoke it.
   */
  rasterizer?: Rasterizer;
  /**
   * How to capture the reference's layout geometry for the structural layout
   * diff. Defaults to {@link puppeteerLayoutExtractor}; runs for every export
   * (independent of the image source) and is a no-op when it returns
   * `undefined` (no Chrome / `puppeteer-core`). Pass `null` to disable.
   */
  layoutExtractor?: LayoutExtractor | null;
}

/** Express an absolute path as a repo-relative, forward-slash URI. */
function repoRelative(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split(/[\\/]/).join("/");
}

export class ClaudeDesignAdapter implements ReferenceAdapter {
  readonly source = "claude-design" as const;
  readonly #rasterize: Rasterizer;
  readonly #extractLayout: LayoutExtractor | null;

  constructor(options: ClaudeDesignAdapterOptions = {}) {
    this.#rasterize = options.rasterizer ?? browserRasterizer;
    this.#extractLayout =
      options.layoutExtractor === undefined
        ? puppeteerLayoutExtractor
        : options.layoutExtractor;
  }

  /**
   * Resolve a Claude Design reference from a committed HTML export.
   *
   * @param componentId resolver-supplied code handle (authoritative).
   * @param ref repo-relative path to the HTML export (the `design-map` ref).
   * @param ctx consumer repo root + environment.
   * @throws if the export is missing, its handoff block is malformed, a
   *   referenced token file or image is missing, or its `componentId`
   *   contradicts `componentId`.
   */
  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const htmlPath = isAbsolute(ref) ? ref : resolve(ctx.repoRoot, ref);

    let html: string;
    try {
      html = await readFile(htmlPath, "utf8");
    } catch (cause) {
      throw new Error(
        `claude-design: cannot read HTML export '${ref}'`,
        { cause },
      );
    }

    const handoff = parseHandoff(html, ref);
    if (handoff?.componentId && handoff.componentId !== componentId) {
      throw new Error(
        `claude-design: export '${ref}' declares componentId ` +
          `'${handoff.componentId}' but was resolved for '${componentId}'`,
      );
    }

    const htmlDir = dirname(htmlPath);
    const tokens = await this.#resolveTokens(handoff, htmlDir, ref);
    const referenceImages = await this.#resolveImages(
      handoff,
      htmlPath,
      htmlDir,
      ctx.repoRoot,
    );

    const reference: DesignReference = {
      componentId,
      source: this.source,
      linkMethod: "manifest",
      ref,
      referenceImages,
    };
    if (tokens) reference.tokens = tokens;

    // Capture the reference's layout geometry for the structural layout diff.
    // Best-effort and isolated: a capture failure must never fail the resolve
    // (the layout diff is advisory and simply doesn't run without it).
    if (this.#extractLayout) {
      try {
        const layout = await this.#extractLayout({ htmlPath });
        if (layout) reference.layout = layout;
      } catch {
        // ignore — no layout geometry this run
      }
    }
    return reference;
  }

  /** Tokens are inline, a sibling handoff JSON file, or absent. */
  async #resolveTokens(
    handoff: HandoffManifest | undefined,
    htmlDir: string,
    ref: string,
  ): Promise<DesignTokens | undefined> {
    const tokens = handoff?.tokens;
    if (tokens === undefined) return undefined;
    if (typeof tokens !== "string") return tokens;

    const tokenPath = resolve(htmlDir, tokens);
    let raw: string;
    try {
      raw = await readFile(tokenPath, "utf8");
    } catch (cause) {
      throw new Error(
        `claude-design: export '${ref}' references a handoff token file ` +
          `'${tokens}' that cannot be read`,
        { cause },
      );
    }
    try {
      return JSON.parse(raw) as DesignTokens;
    } catch (cause) {
      throw new Error(
        `claude-design: handoff token file '${tokens}' is not valid JSON`,
        { cause },
      );
    }
  }

  /**
   * One {@link Image} per declared variant. A variant with `src` reads its
   * dimensions from the committed PNG; a variant without one is rasterized. An
   * export with no declared images is rasterized as a single default variant.
   */
  async #resolveImages(
    handoff: HandoffManifest | undefined,
    htmlPath: string,
    htmlDir: string,
    repoRoot: string,
  ): Promise<Image[]> {
    const variants = handoff?.images?.length
      ? handoff.images
      : [{ state: "default" }];

    const images: Image[] = [];
    for (const variant of variants) {
      const state = variant.state ?? "default";
      let uri: string;
      let width: number;
      let height: number;

      if (variant.src) {
        const pngPath = resolve(htmlDir, variant.src);
        ({ width, height } = await readPngSize(pngPath));
        uri = repoRelative(repoRoot, pngPath);
      } else {
        const rendered = await this.#rasterize({
          htmlPath,
          state,
          theme: variant.theme,
          size: variant.size,
        });
        width = rendered.width;
        height = rendered.height;
        uri = repoRelative(repoRoot, rendered.pngPath);
      }

      const image: Image = { state, uri, width, height };
      if (variant.theme) image.theme = variant.theme;
      if (variant.size) image.size = variant.size;
      images.push(image);
    }
    return images;
  }
}
