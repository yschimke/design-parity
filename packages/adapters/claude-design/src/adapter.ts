/**
 * The Claude Design reference adapter.
 *
 * Claude Design (beta since 2026-06) exposes **no read API and no Figma
 * export**, so unlike the Figma adapter there is nothing to fetch at run time.
 * The reference is a committed HTML export, linked from the repo's
 * `design-map.json` by a repo-relative path. (Claude Code's `/design-sync` can
 * now emit those committed artifacts, but it is a governed read->plan->write
 * skill, not an API this adapter calls -- see docs/claude-design-sync-impact.md.)
 * This adapter resolves three committed ref shapes:
 *
 *   - an **HTML export** (any other ref): resolve the path, parse the embedded
 *     handoff manifest (tokens + image variants), rasterize any raw-HTML variant
 *     headlessly, and normalize to a {@link DesignReference};
 *   - a **synced token artifact** (a `.json` ref): a committed DTCG document
 *     emitted by `/design-sync`, loaded through core's DTCG reader into a
 *     token-only `DesignReference` (no images, no rasterise) — issue #149; and
 *   - a **live-render prototype** (a `live:`-prefixed ref): drive the actual
 *     clickable prototype in a browser and capture it at each configured
 *     viewport, instead of rasterizing a static export — a truer, multi-viewport
 *     reference (issue #85). Opt-in; the default stays the static export path.
 *
 * Every shape yields `linkMethod: "manifest"` — the only link method possible
 * for a source with no read API.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type {
  AdapterContext,
  DesignReference,
  DesignTokens,
  Image,
  ReferenceAdapter,
} from "@design-parity/core";
import { loadDtcgTokens } from "@design-parity/core";

import { parseHandoff, type HandoffManifest } from "./html-export.js";
import { readPngSize } from "./png.js";
import { readSvgSize } from "./svg.js";
import { browserRasterizer, type Rasterizer } from "./rasterizer.js";
import {
  browserLiveRenderer,
  DEFAULT_LIVE_VIEWPORTS,
  type LiveRenderer,
  type LiveViewport,
} from "./live-renderer.js";
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
   * How to live-render a prototype (a `live:`-prefixed ref) at each configured
   * viewport. Defaults to {@link browserLiveRenderer} (headless Chrome/Chromium);
   * a caller running Playwright or a hosted renderer injects its own. Only the
   * live-render path invokes it — a plain committed-export ref never does.
   */
  liveRenderer?: LiveRenderer;
  /**
   * The viewports a live-render ref is captured at. Defaults to
   * {@link DEFAULT_LIVE_VIEWPORTS} (a single compact frame); pass a wider matrix
   * to capture several breakpoints, each keyed onto its `size` variant slot.
   */
  liveViewports?: LiveViewport[];
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

/**
 * A `design-map.json` ref ending in `.json` is a **synced design-system token
 * artifact** — a DTCG document emitted by Claude Code's `/design-sync` (or any
 * committed DTCG file) — rather than an HTML export. It carries tokens only, so
 * the adapter loads it through core's DTCG reader with no rasterise (issue #149).
 */
function isSyncedTokenRef(ref: string): boolean {
  return /\.json$/i.test(ref);
}

/** The scheme that opts a ref into live-render mode. */
const LIVE_SCHEME = "live:";

/**
 * A `design-map.json` ref prefixed `live:` selects the **live-render** path:
 * the adapter drives the referenced prototype in a browser and captures it at
 * each configured viewport, instead of rasterizing a committed static export
 * (issue #85). The prefix is the config-driven opt-in — the default (an
 * unprefixed path) stays the lighter static path. Mirrors the `figma:` / `stitch:`
 * ref schemes the other adapters key on.
 */
function isLiveRenderRef(ref: string): boolean {
  return ref.startsWith(LIVE_SCHEME);
}

export class ClaudeDesignAdapter implements ReferenceAdapter {
  readonly source = "claude-design" as const;
  readonly #rasterize: Rasterizer;
  readonly #liveRender: LiveRenderer;
  readonly #liveViewports: LiveViewport[];
  readonly #extractLayout: LayoutExtractor | null;

  constructor(options: ClaudeDesignAdapterOptions = {}) {
    this.#rasterize = options.rasterizer ?? browserRasterizer;
    this.#liveRender = options.liveRenderer ?? browserLiveRenderer;
    this.#liveViewports = options.liveViewports ?? DEFAULT_LIVE_VIEWPORTS;
    this.#extractLayout =
      options.layoutExtractor === undefined
        ? puppeteerLayoutExtractor
        : options.layoutExtractor;
  }

  /**
   * Resolve a Claude Design reference from a committed HTML export, or — when
   * `ref` ends in `.json` — from a synced DTCG token artifact (see
   * {@link isSyncedTokenRef} and {@link #resolveSyncedTokens}).
   *
   * @param componentId resolver-supplied code handle (authoritative).
   * @param ref repo-relative path to the HTML export or the `.json` token
   *   artifact (the `design-map` ref).
   * @param ctx consumer repo root + environment.
   * @throws if the export/artifact is missing, its handoff block is malformed, a
   *   referenced token file or image is missing, or its `componentId`
   *   contradicts `componentId`.
   */
  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    if (isLiveRenderRef(ref)) {
      return this.#resolveLiveRender(componentId, ref, ctx);
    }

    if (isSyncedTokenRef(ref)) {
      return this.#resolveSyncedTokens(componentId, ref, ctx);
    }

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

  /**
   * Resolve a synced design-system token artifact (a committed DTCG document,
   * typically emitted by Claude Code's `/design-sync`). This is a token-only
   * reference: there is no HTML, so nothing rasterizes and `referenceImages` is
   * empty — the resulting `DesignReference` feeds the token-compliance diff
   * only. There is still no read API, so `linkMethod` stays `"manifest"`.
   *
   * @throws if the file is missing, isn't JSON, or fails DTCG schema validation
   *   (delegated to core's {@link loadDtcgTokens}, re-prefixed for this source).
   */
  async #resolveSyncedTokens(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const tokenPath = isAbsolute(ref) ? ref : resolve(ctx.repoRoot, ref);

    let tokens: DesignTokens;
    try {
      ({ tokens } = await loadDtcgTokens(tokenPath));
    } catch (cause) {
      throw new Error(
        `claude-design: cannot load synced token artifact '${ref}': ` +
          (cause instanceof Error ? cause.message : String(cause)),
        { cause },
      );
    }

    const reference: DesignReference = {
      componentId,
      source: this.source,
      linkMethod: "manifest",
      ref,
      referenceImages: [],
    };
    if (Object.keys(tokens).length > 0) reference.tokens = tokens;
    return reference;
  }

  /**
   * Resolve a Claude Design reference by **live-rendering a prototype** at each
   * configured viewport (a `live:`-prefixed ref, issue #85). Unlike the static
   * export path, this drives the actual clickable prototype in a browser and
   * captures one frame per viewport, each keyed onto its `size` variant slot so
   * it pairs against the candidate's matching per-breakpoint render. Normalizes
   * to the same {@link DesignReference} (`linkMethod: "manifest"`, no read API),
   * so the diff engine stays source-agnostic.
   *
   * @throws if the ref carries no path, the prototype is unreadable, or every
   *   configured viewport fails to render.
   */
  async #resolveLiveRender(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const rawPath = ref.slice(LIVE_SCHEME.length);
    if (rawPath.length === 0) {
      throw new Error(
        `claude-design: live-render ref '${ref}' names no prototype path`,
      );
    }
    const prototypePath = isAbsolute(rawPath)
      ? rawPath
      : resolve(ctx.repoRoot, rawPath);
    try {
      await access(prototypePath);
    } catch (cause) {
      throw new Error(
        `claude-design: cannot read prototype '${rawPath}' for live-render`,
        { cause },
      );
    }

    const referenceImages: Image[] = [];
    for (const viewport of this.#liveViewports) {
      const rendered = await this.#liveRender({ prototypePath, viewport });
      referenceImages.push({
        state: "default",
        size: viewport.size,
        uri: repoRelative(ctx.repoRoot, rendered.pngPath),
        width: rendered.width,
        height: rendered.height,
      });
    }

    return {
      componentId,
      source: this.source,
      linkMethod: "manifest",
      ref,
      referenceImages,
    };
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
        // A committed reference image is a PNG or a vector SVG; read its
        // intrinsic size from the bytes either way (never the manifest).
        const srcPath = resolve(htmlDir, variant.src);
        ({ width, height } = /\.svg$/i.test(variant.src)
          ? await readSvgSize(srcPath)
          : await readPngSize(srcPath));
        uri = repoRelative(repoRoot, srcPath);
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
