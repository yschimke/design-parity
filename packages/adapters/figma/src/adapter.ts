/**
 * The Figma {@link ReferenceAdapter}: resolve a component to a node (via the
 * `ref` or Code Connect), fetch structure + variables + a rendered image over
 * REST, and normalize to a {@link DesignReference}. All network is injectable.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AdapterContext,
  DesignReference,
  Image,
  ReferenceAdapter,
  Theme,
} from "@design-parity/core";

import {
  loadCodeConnect,
  resolveFromCodeConnect,
} from "./code-connect.js";
import { FigmaBadRefError, FigmaNodeNotFoundError } from "./errors.js";
import { formatFigmaRef, isFigmaRef, parseFigmaRef, type FigmaRef } from "./figma-ref.js";
import { pngSize } from "./png.js";
import { svgSize } from "./svg.js";
import { normalizeReference } from "./normalize.js";
import {
  FigmaRestClient,
  type FetchLike,
  type FigmaRestClientOptions,
} from "./rest-client.js";

/** One image to render: a node, tagged with the variant it represents. */
export interface RenderTarget {
  nodeId: string;
  state?: string;
  theme?: Theme;
  size?: string;
}

export interface FigmaAdapterOptions {
  /** Pre-built client (tests inject this). Overrides `fetch`/`baseUrl`. */
  client?: FigmaRestClient;
  /** Injectable fetch used when building a client from `ctx.env`. */
  fetch?: FetchLike;
  /** API base override (tests). */
  baseUrl?: string;
  /** Directory rendered references are written to. Defaults under the repo root. */
  outDir?: string;
  /** Image render scale (Figma `scale`, PNG only). Defaults to 2. */
  imageScale?: number;
  /**
   * Reference image format. `svg` (default) imports the design as resolution-free
   * vector — crisp in the report, rasterised on the fly for the pixel diff; `png`
   * keeps the legacy raster export at {@link FigmaAdapterOptions.imageScale}.
   */
  imageFormat?: "png" | "svg";
  /** Code Connect JSON to consult when `ref` is not a figma handle. */
  codeConnectPath?: string;
  /**
   * Produce the render targets for a resolved ref — e.g. one node per theme.
   * Defaults to a single image of the ref's node with no theme/size tag.
   */
  resolveTargets?: (
    ref: FigmaRef,
    ctx: AdapterContext,
  ) => RenderTarget[] | Promise<RenderTarget[]>;
}

const TOKEN_ENV = ["FIGMA_TOKEN", "FIGMA_PAT", "FIGMA_ACCESS_TOKEN"] as const;

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class FigmaAdapter implements ReferenceAdapter {
  readonly source = "figma" as const;
  readonly #opts: FigmaAdapterOptions;

  constructor(opts: FigmaAdapterOptions = {}) {
    this.#opts = opts;
  }

  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const figmaRef = await this.#resolveRef(componentId, ref, ctx);
    const client = this.#client(ctx);

    // Structure (tokens) comes from the primary node; fail clearly if absent.
    const nodes = await client.getFileNodes(figmaRef.fileKey, [figmaRef.nodeId]);
    const entry = nodes.nodes[figmaRef.nodeId];
    const node = entry?.document;
    if (!node) {
      throw new FigmaNodeNotFoundError(figmaRef.fileKey, figmaRef.nodeId);
    }

    const variables = await client.getLocalVariables(figmaRef.fileKey);

    const targets = (await this.#opts.resolveTargets?.(figmaRef, ctx)) ?? [
      { nodeId: figmaRef.nodeId, state: "default" },
    ];

    const outDir = this.#opts.outDir ?? join(ctx.repoRoot, ".design-parity", "cache", "figma");
    await mkdir(outDir, { recursive: true });

    const format = this.#opts.imageFormat ?? "svg";
    const referenceImages: Image[] = [];
    for (const target of targets) {
      const rendered = await client.renderImage(figmaRef.fileKey, target.nodeId, {
        scale: this.#opts.imageScale,
        format,
      });
      const { width, height } =
        format === "svg" ? svgSize(rendered.bytes) : pngSize(rendered.bytes);
      const file = join(
        outDir,
        `${slug(componentId)}--${target.theme ?? target.state ?? "default"}--${target.size ?? "default"}.${format}`,
      );
      await writeFile(file, rendered.bytes);

      const image: Image = { state: target.state ?? "default", uri: file, width, height };
      if (target.theme) image.theme = target.theme;
      if (target.size) image.size = target.size;
      referenceImages.push(image);
    }

    return normalizeReference({
      componentId,
      ref: formatFigmaRef(figmaRef),
      node,
      variables,
      ...(entry.styles ? { styles: entry.styles } : {}),
      referenceImages,
    });
  }

  async #resolveRef(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<FigmaRef> {
    if (isFigmaRef(ref)) return parseFigmaRef(ref);

    // Not a direct handle — consult Code Connect (the machine link).
    const path =
      this.#opts.codeConnectPath ??
      ctx.env.FIGMA_CODE_CONNECT_FILE ??
      join(ctx.repoRoot, "figma.code-connect.json");
    const map = await loadCodeConnect(path);
    const resolved =
      resolveFromCodeConnect(componentId, map) ?? resolveFromCodeConnect(ref, map);
    if (!resolved) throw new FigmaBadRefError(ref);
    return resolved;
  }

  #client(ctx: AdapterContext): FigmaRestClient {
    if (this.#opts.client) return this.#opts.client;
    const oauthToken = ctx.env.FIGMA_OAUTH_TOKEN;
    const token = TOKEN_ENV.map((k) => ctx.env[k]).find(Boolean);
    const clientOpts: FigmaRestClientOptions = {};
    if (oauthToken) clientOpts.oauthToken = oauthToken;
    if (token) clientOpts.token = token;
    if (this.#opts.fetch) clientOpts.fetch = this.#opts.fetch;
    if (this.#opts.baseUrl) clientOpts.baseUrl = this.#opts.baseUrl;
    return new FigmaRestClient(clientOpts);
  }
}

/** Convenience factory. */
export function createFigmaAdapter(opts: FigmaAdapterOptions = {}): FigmaAdapter {
  return new FigmaAdapter(opts);
}
