/**
 * The Figma {@link ReferenceAdapter}: resolve a component to a node (via the
 * `ref` or Code Connect), fetch structure + variables + a rendered image over
 * REST, and normalize to a {@link DesignReference}. All network is injectable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AdapterContext,
  DesignReference,
  Image,
  ReferenceAdapter,
  SiblingTarget,
  Theme,
} from "@design-parity/core";

import {
  loadCodeConnect,
  resolveFromCodeConnect,
} from "./code-connect.js";
import {
  FigmaBadRefError,
  FigmaCacheMissError,
  FigmaNodeNotFoundError,
} from "./errors.js";
import type { ReferenceCache } from "./reference-cache.js";
import { formatFigmaRef, isFigmaRef, parseFigmaRef, type FigmaRef } from "./figma-ref.js";
import type {
  FigmaComponentMeta,
  FigmaNodeDoc,
  FigmaStyleMeta,
  VariablesResponse,
} from "./figma-api.js";
import { referenceProperties } from "./properties.js";
import {
  canonicalAxis,
  parseVariantName,
  sameAxes,
  type VariantAxes,
} from "./variant-name.js";

/** What a nodes response carries per id — the document, the styles, the components. */
interface CachedNode {
  document: FigmaNodeDoc;
  styles?: Record<string, FigmaStyleMeta>;
  components?: Record<string, FigmaComponentMeta>;
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
   * A committed reference cache (see `reference-cache.ts`) to read structure,
   * variables and reference images from instead of calling Figma.
   *
   * A hit costs no request at all; a miss falls through to the API, so adding a
   * cache can only reduce the calls a run makes. Pair with
   * {@link FigmaAdapterOptions.cacheOnly} for the guarantee rather than the
   * tendency.
   */
  cache?: ReferenceCache;
  /**
   * Make the cache the ONLY reference source: a miss raises
   * {@link FigmaCacheMissError} rather than reaching for the network.
   *
   * This is what a parity run on a code change wants. Zero Figma calls means no
   * rate limit and no network flake, and the diff is reproducible because the
   * reference is pinned to what the last import saw rather than to whatever the
   * file happens to say at the moment the job runs. A miss is a per-component
   * error the run already fails soft on — one honest gap on a board, not a
   * silently dropped row.
   */
  cacheOnly?: boolean;
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
  /**
   * `fileKey/setId` -> the component set's document, or `null` for one we asked
   * for and did not get. Caching the miss matters as much as the hit: without
   * it every node in a set whose fetch failed re-asks for the same set.
   */
  readonly #sets = new Map<string, FigmaNodeDoc | null>();
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
    // Nothing to warm when the run reads the committed cache and nothing else:
    // every hit is already local, and every miss is going to be reported as a
    // miss rather than fetched.
    if (this.#opts.cacheOnly) return;

    const byFile = new Map<string, Set<string>>();
    for (const ref of refs) {
      // A ref Code Connect resolves is not parseable here and is not an error:
      // `parseFigmaRef` THROWS on one, which would abandon the warm for every
      // other ref in the list and put the run back to one request per
      // component — the exact cost this method exists to remove.
      let parsed: FigmaRef;
      try {
        parsed = parseFigmaRef(ref);
      } catch {
        continue;
      }
      // A cached node needs no request; asking for it anyway would spend the
      // very quota the cache exists to protect.
      if (this.#opts.cache?.entry(parsed.fileKey, parsed.nodeId)) continue;
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
      await this.#warmSets(client, fileKey, ids);
    }
  }

  /**
   * Second batched pass: the component **sets** the warmed nodes belong to.
   *
   * A variant node carries neither its set's `componentPropertyDefinitions` nor
   * its siblings — both live on the set — and Figma returns definitions only for
   * nodes asked for directly. So the set is a second read, and doing it here
   * makes it a handful of requests for the whole run instead of one per
   * component. Best-effort, like the node pass: a chunk that fails leaves those
   * references without properties rather than failing the run.
   */
  async #warmSets(
    client: FigmaRestClient,
    fileKey: string,
    nodeIds: readonly string[],
  ): Promise<void> {
    if (this.#opts.cacheOnly) return;
    const setIds = new Set<string>();
    for (const id of nodeIds) {
      const setId = this.#setIdFor(fileKey, id);
      if (setId && !this.#sets.has(`${fileKey}/${setId}`)) setIds.add(setId);
    }
    if (setIds.size === 0) return;

    const ids = [...setIds];
    for (let i = 0; i < ids.length; i += NODE_BATCH) {
      const chunk = ids.slice(i, i + NODE_BATCH);
      try {
        const res = await client.getFileNodes(fileKey, chunk);
        for (const id of chunk) {
          this.#sets.set(`${fileKey}/${id}`, res.nodes[id]?.document ?? null);
        }
      } catch {
        // Unwarmed, not absent — leave the key unset so a later read can retry.
      }
    }
  }

  /** The id of the component set `nodeId` is a variant of, per its file metadata. */
  #setIdFor(fileKey: string, nodeId: string): string | undefined {
    const entry = this.#nodes.get(`${fileKey}/${nodeId}`);
    return entry?.components?.[nodeId]?.componentSetId;
  }

  /**
   * The component set behind a node: this run's warm, then the committed cache,
   * then the API — the same order, and the same reasons, as the node itself.
   *
   * The import stores sets as ordinary structure-only entries, so a `cacheOnly`
   * run still knows what its references depict. Returns `undefined` when the
   * node is not a variant, or when the set could not be read at all —
   * properties are additive, so a miss degrades the reference rather than
   * failing it.
   */
  async #componentSet(
    client: () => FigmaRestClient,
    fileKey: string,
    nodeId: string,
  ): Promise<FigmaNodeDoc | undefined> {
    const setId = this.#setIdFor(fileKey, nodeId);
    if (!setId) return undefined;
    const key = `${fileKey}/${setId}`;
    if (!this.#sets.has(key)) {
      const committed = await this.#opts.cache?.node(fileKey, setId);
      if (committed?.document) {
        this.#sets.set(key, committed.document);
      } else if (this.#opts.cacheOnly) {
        // A cache built before sets were stored simply has no properties for
        // this node. Silent is wrong, but so is spending a request the run
        // promised not to make; the report shows the reference without them.
        this.#sets.set(key, null);
      } else {
        try {
          const res = await client().getFileNodes(fileKey, [setId]);
          this.#sets.set(key, res.nodes[setId]?.document ?? null);
        } catch {
          this.#sets.set(key, null);
        }
      }
    }
    return this.#sets.get(key) ?? undefined;
  }

  /**
   * Read a node: this run's warm, the committed cache, then the API.
   * `undefined` when absent — or when only the API has it and this run is not
   * allowed to ask.
   */
  async #node(
    client: () => FigmaRestClient,
    fileKey: string,
    nodeId: string,
  ): Promise<CachedNode | undefined> {
    const key = `${fileKey}/${nodeId}`;
    const warm = this.#nodes.get(key);
    if (warm) return warm;
    const committed = await this.#opts.cache?.node(fileKey, nodeId);
    if (committed?.document) {
      this.#nodes.set(key, committed);
      return committed;
    }
    if (this.#opts.cacheOnly) return undefined;
    const res = await client().getFileNodes(fileKey, [nodeId]);
    const fetched = res.nodes[nodeId];
    if (!fetched?.document) return undefined;
    this.#nodes.set(key, fetched);
    return fetched;
  }

  /**
   * The same component with one variant axis moved — `Size=Small` →
   * `Size=Medium` — as a `figma:<fileKey>/<nodeId>` handle.
   *
   * A component set's variant names are axis vectors and every child names
   * every axis, so this is a lookup in the set's children rather than a guess.
   * That makes it Figma's data model, not any consumer's taxonomy, which is why
   * it belongs on the adapter: every consumer comparing more than a default
   * state needs it.
   *
   * Returns `undefined` — deliberately, and for every failure alike: the ref is
   * not a Figma handle, the node is not a variant, its set could not be read,
   * the axis is not one this component has, or no sibling carries that value. A
   * translation the source does not have must find *nothing*, because the
   * alternative is a confident reference to the wrong node.
   */
  async resolveSibling(
    ref: string,
    target: SiblingTarget,
    ctx: AdapterContext,
  ): Promise<string | undefined> {
    if (!isFigmaRef(ref)) return undefined;
    const { fileKey, nodeId } = parseFigmaRef(ref);
    // Lazily, like `resolve`: a cache-only run has no token to build one with,
    // and demanding one to read files off disk would be a network dependency
    // in all but name.
    let restClient: FigmaRestClient | undefined;
    const client = (): FigmaRestClient => (restClient ??= this.#client(ctx));

    let entry: CachedNode | undefined;
    try {
      entry = await this.#node(client, fileKey, nodeId);
    } catch {
      return undefined;
    }
    if (!entry) return undefined;

    const axes = parseVariantName(entry.document.name);
    if (axes.size === 0) return undefined;
    const axis = canonicalAxis(axes.keys(), target.axis);
    if (axis === undefined) return undefined;

    const set = await this.#componentSet(client, fileKey, nodeId);
    if (!set) return undefined;

    const wanted: VariantAxes = new Map(axes);
    wanted.set(axis, target.value);
    const sibling = (set.children ?? []).find((child) =>
      sameAxes(wanted, parseVariantName(child.name)),
    );
    return sibling ? formatFigmaRef({ fileKey, nodeId: sibling.id }) : undefined;
  }

  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const figmaRef = await this.#resolveRef(componentId, ref, ctx);
    const committed = this.#opts.cache;
    const cacheOnly = this.#opts.cacheOnly === true;

    // Built on first use, not up front: a `cacheOnly` run has no Figma token to
    // give it, and demanding one to read files off disk would be a network
    // dependency in all but name.
    let restClient: FigmaRestClient | undefined;
    const client = (): FigmaRestClient => (restClient ??= this.#client(ctx));

    // Structure (tokens) comes from the primary node; fail clearly if absent.
    // Three places it can come from, cheapest first: this run's in-memory warm,
    // the committed cache, then the API.
    const cacheKey = `${figmaRef.fileKey}/${figmaRef.nodeId}`;
    let entry = this.#nodes.get(cacheKey);
    if (!entry) {
      const cached = await committed?.node(figmaRef.fileKey, figmaRef.nodeId);
      if (cached?.document) {
        entry = cached;
        this.#nodes.set(cacheKey, cached);
      }
    }
    if (!entry && cacheOnly) {
      throw new FigmaCacheMissError(figmaRef.fileKey, figmaRef.nodeId, "no structure");
    }
    if (!entry) {
      const nodes = await client().getFileNodes(figmaRef.fileKey, [figmaRef.nodeId]);
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

    // What the render will actually depict. `/v1/images` renders at the
    // component's property defaults, and those defaults are named nowhere in
    // the variant — so without this the reference silently carries whatever the
    // kit's author defaulted on, and the diff blames the candidate for it.
    const set = await this.#componentSet(client, figmaRef.fileKey, figmaRef.nodeId);
    const properties = referenceProperties(node, set);

    // One response per file rather than one per component: the variables of a
    // file do not vary by which node is being resolved, and 77 identical
    // requests spend the same quota the references need. The promise is cached
    // rather than the value, so concurrent callers share one request.
    let variablesPromise = this.#variables.get(figmaRef.fileKey);
    if (!variablesPromise) {
      variablesPromise = committed?.file(figmaRef.fileKey)?.variables
        ? committed.variables(figmaRef.fileKey)
        : cacheOnly
          ? // A file imported without variables (not Enterprise, or the import
            // could not read them) degrades to structure-only tokens — the same
            // shape `getLocalVariables` returns for a 403.
            Promise.resolve({})
          : client().getLocalVariables(figmaRef.fileKey);
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
      // A committed render is used where it lies: the bytes are already on
      // disk, and copying them into `outDir` would double a catalog's images
      // to save nothing. The cache's own format wins over `imageFormat` —
      // what was imported is what there is.
      const cachedImage = committed?.entry(figmaRef.fileKey, target.nodeId);
      let bytes: Uint8Array;
      let file: string;
      let imageFormat: "png" | "svg";
      if (committed && cachedImage?.image) {
        file = committed.path(cachedImage.image);
        bytes = await readFile(file);
        imageFormat = cachedImage.imageFormat ?? format;
      } else if (cacheOnly) {
        throw new FigmaCacheMissError(figmaRef.fileKey, target.nodeId, "no rendered image");
      } else {
        const rendered = await client().renderImage(figmaRef.fileKey, target.nodeId, {
          scale: this.#opts.imageScale,
          format,
        });
        bytes = rendered.bytes;
        imageFormat = format;
        file = join(
          outDir,
          `${slug(componentId)}--${target.theme ?? target.state ?? "default"}--${target.size ?? "default"}.${format}`,
        );
        await writeFile(file, bytes);
      }
      const { width, height } =
        imageFormat === "svg" ? svgSize(bytes) : pngSize(bytes);

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
      ...(properties.length > 0 ? { properties } : {}),
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
