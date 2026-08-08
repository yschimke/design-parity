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
import type { FigmaNodeDoc, FigmaStyleMeta, VariablesResponse } from "./figma-api.js";

/** What a nodes response carries per id — the document, and the styles it uses. */
interface CachedNode {
  document: FigmaNodeDoc;
  styles?: Record<string, FigmaStyleMeta>;
}

/**
 * Node ids per `GET /v1/files/:key/nodes` call. Chosen well under any documented
 * ceiling: the win is going from one-per-component to a handful, and a chunk
 * small enough to retry cheaply beats one large enough to be worth splitting.
 */
const NODE_BATCH = 50;
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
  /**
   * Attempts per REST request before a 429/5xx is raised. Defaults to the
   * client's own default; 1 disables retrying, which is what a test asserting
   * the error mapping wants.
   */
  attempts?: number;
  /** Injectable delay for the retry backoff (tests). */
  sleep?: (ms: number) => Promise<void>;
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
  /** `fileKey/nodeId` -> node entry, filled by {@link prefetch}. */
  readonly #nodes = new Map<string, CachedNode>();
  /** `fileKey` -> variables. One response per file, not one per component. */
  readonly #variables = new Map<string, Promise<VariablesResponse>>();

  constructor(opts: FigmaAdapterOptions = {}) {
    this.#opts = opts;
  }

  /**
   * Read every node the run will need, in as few requests as the API allows.
   *
   * `GET /v1/files/:key/nodes` takes a list, and the client has always accepted
   * one — but `resolve` runs per component and asked for a single id each time,
   * so a 77-component catalog made 77 requests for something two would have
   * carried. Against a per-token limiter that is the difference between a run
   * that completes and one that loses most of its references to 429s.
   *
   * Best-effort by contract: a chunk that fails is left out of the cache and
   * `resolve` fetches it alone, so a partial warm degrades to today's behaviour
   * rather than failing the run.
   */
  async prefetch(refs: readonly string[], ctx: AdapterContext): Promise<void> {
    const byFile = new Map<string, Set<string>>();
    for (const ref of refs) {
      const parsed = parseFigmaRef(ref);
      if (!parsed) continue;
      const ids = byFile.get(parsed.fileKey) ?? new Set<string>();
      ids.add(parsed.nodeId);
      byFile.set(parsed.fileKey, ids);
    }
    if (byFile.size === 0) return;

    const client = this.#client(ctx);
    for (const [fileKey, idSet] of byFile) {
      const ids = [...idSet];
      for (let i = 0; i < ids.length; i += NODE_BATCH) {
        const chunk = ids.slice(i, i + NODE_BATCH);
        try {
          const res = await client.getFileNodes(fileKey, chunk);
          for (const id of chunk) {
            const entry = res.nodes[id];
            if (entry?.document) this.#nodes.set(`${fileKey}/${id}`, entry);
          }
        } catch {
          // Leave the chunk unwarmed; `resolve` will ask for those ids itself.
        }
      }
    }
  }

  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const figmaRef = await this.#resolveRef(componentId, ref, ctx);
    const client = this.#client(ctx);

    // Structure (tokens) comes from the primary node; fail clearly if absent.
    // `prefetch` has usually put it here already; a miss is not an error, only
    // a request this run had hoped to avoid.
    const cacheKey = `${figmaRef.fileKey}/${figmaRef.nodeId}`;
    let entry = this.#nodes.get(cacheKey);
    if (!entry) {
      const nodes = await client.getFileNodes(figmaRef.fileKey, [figmaRef.nodeId]);
      const fetched = nodes.nodes[figmaRef.nodeId];
      if (fetched?.document) {
        entry = fetched;
        this.#nodes.set(cacheKey, fetched);
      }
    }
    if (!entry) {
      throw new FigmaNodeNotFoundError(figmaRef.fileKey, figmaRef.nodeId);
    }
    const node = entry.document;

    // One response per file rather than one per component: the variables of a
    // file do not vary by which node is being resolved, and 77 identical
    // requests spend the same quota the references need. The promise is cached
    // rather than the value, so concurrent callers share one request.
    let variablesPromise = this.#variables.get(figmaRef.fileKey);
    if (!variablesPromise) {
      variablesPromise = client.getLocalVariables(figmaRef.fileKey);
      this.#variables.set(figmaRef.fileKey, variablesPromise);
    }
    const variables = await variablesPromise;

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
    if (this.#opts.attempts !== undefined) clientOpts.attempts = this.#opts.attempts;
    if (this.#opts.sleep) clientOpts.sleep = this.#opts.sleep;
    return new FigmaRestClient(clientOpts);
  }
}

/** Convenience factory. */
export function createFigmaAdapter(opts: FigmaAdapterOptions = {}): FigmaAdapter {
  return new FigmaAdapter(opts);
}
