/**
 * Thin Figma REST client. Network is injectable (`fetch`) so unit tests run
 * offline. Maps HTTP failures onto the adapter's typed errors.
 */
import {
  FigmaApiError,
  FigmaAuthError,
  FigmaNodeNotFoundError,
  FigmaRateLimitError,
} from "./errors.js";
import type {
  FileMetaResponse,
  FileNodesResponse,
  ImagesResponse,
  VariablesResponse,
} from "./figma-api.js";

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export interface FigmaRestClientOptions {
  /** Personal access token (sent as `X-Figma-Token`). */
  token?: string;
  /** OAuth bearer token (sent as `Authorization: Bearer`). Takes precedence. */
  oauthToken?: string;
  /** Override the API base (tests). Defaults to the public API. */
  baseUrl?: string;
  /** Injectable fetch. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /**
   * Attempts per request before a retryable failure is raised. 1 disables
   * retrying. Defaults to {@link DEFAULT_ATTEMPTS}.
   */
  attempts?: number;
  /** Injectable delay (tests). Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Four attempts: ~1s + ~2s + ~4s of backoff at worst, which clears the short
 * per-token window Figma applies to a burst of node reads without turning a
 * genuinely exhausted quota into a seven-minute job.
 */
export const DEFAULT_ATTEMPTS = 4;

/** Ceiling on a single backoff wait, including a server-sent `Retry-After`. */
const MAX_BACKOFF_MS = 60_000;

export interface RenderedImage {
  bytes: Uint8Array;
  /** The signed URL the bytes were downloaded from (trace/debug). */
  url: string;
}

export class FigmaRestClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #authHeaders: Record<string, string>;
  readonly #attempts: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: FigmaRestClientOptions) {
    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error("figma: no fetch available; pass one via options.fetch");
    }
    this.#fetch = fetchImpl;
    this.#baseUrl = (opts.baseUrl ?? "https://api.figma.com").replace(/\/$/, "");
    this.#attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
    this.#sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    if (opts.oauthToken) {
      this.#authHeaders = { Authorization: `Bearer ${opts.oauthToken}` };
    } else if (opts.token) {
      this.#authHeaders = { "X-Figma-Token": opts.token };
    } else {
      throw new FigmaAuthError(
        "figma: no credentials — set FIGMA_TOKEN (PAT) or FIGMA_OAUTH_TOKEN",
      );
    }
  }

  /**
   * One request, retried while the failure is transient.
   *
   * A 429 is the expected response to reading many nodes in a row, not an
   * error: the limiter is per token, and a caller resolving a catalog's worth
   * of references trips it by shape rather than by misuse. Retrying it here is
   * what stops that turning into a missing component downstream — the adapter
   * fails soft per reference, so an unretried 429 reads as "no reference" on an
   * otherwise green run.
   *
   * `Retry-After` wins when the server sends one, since it knows the window;
   * otherwise back off exponentially. 5xx gets the same treatment. Anything
   * else — auth, a bad node id — is terminal, and retrying only delays it.
   */
  async #fetchRetrying(
    url: string,
    init?: { headers?: Record<string, string> },
  ): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.#fetch(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (res.ok || !retryable || attempt >= this.#attempts) return res;

      const header = Number(res.headers.get("retry-after"));
      const waitMs = Math.min(
        MAX_BACKOFF_MS,
        Number.isFinite(header) && header > 0
          ? header * 1_000
          : 2 ** attempt * 500,
      );
      await this.#sleep(waitMs);
    }
  }

  async #get<T>(path: string): Promise<T> {
    const res = await this.#fetchRetrying(`${this.#baseUrl}${path}`, {
      headers: this.#authHeaders,
    });
    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new FigmaAuthError(
        `figma: authentication failed (${res.status}) for ${path}${body ? ` — ${body}` : ""}`,
      );
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after"));
      throw new FigmaRateLimitError(
        `figma: rate limited (429) for ${path} after ${this.#attempts} attempt(s)`,
        Number.isFinite(retry) ? retry : undefined,
      );
    }
    throw new FigmaApiError(
      res.status,
      `figma: request failed (${res.status}) for ${path}${body ? ` — ${body}` : ""}`,
    );
  }

  /**
   * `GET /v1/files/:key?depth=1` — the file's own metadata, without dragging
   * the document down the wire.
   *
   * `version` changes on every edit, so a caller holding cached references can
   * decide in ONE request whether any of them can have moved, rather than
   * re-reading every node to find out that nothing did.
   */
  async getFileMeta(fileKey: string): Promise<FileMetaResponse> {
    return this.#get<FileMetaResponse>(`/v1/files/${fileKey}?depth=1`);
  }

  /** `GET /v1/files/:key/nodes?ids=` — structure for the requested nodes. */
  async getFileNodes(
    fileKey: string,
    ids: string[],
  ): Promise<FileNodesResponse> {
    const q = encodeURIComponent(ids.join(","));
    return this.#get<FileNodesResponse>(`/v1/files/${fileKey}/nodes?ids=${q}`);
  }

  /**
   * `GET /v1/files/:key/variables/local` — variable collections + modes.
   * Enterprise-only; returns `{}` (not an error) on 403/404 so the adapter
   * degrades to structure-only tokens.
   */
  async getLocalVariables(fileKey: string): Promise<VariablesResponse> {
    try {
      return await this.#get<VariablesResponse>(
        `/v1/files/${fileKey}/variables/local`,
      );
    } catch (err) {
      if (
        err instanceof FigmaAuthError ||
        (err instanceof FigmaApiError && err.status === 404)
      ) {
        return {};
      }
      throw err;
    }
  }

  /**
   * `GET /v1/images/:key?ids=&format=…` then download the result. `png` honours
   * `scale`; `svg` is resolution-free so `scale` is omitted (Figma ignores it).
   */
  async renderImage(
    fileKey: string,
    nodeId: string,
    opts: {
      scale?: number;
      format?: "png" | "svg";
      /** Include only the node's own contents; false also renders overlapping layers. */
      contentsOnly?: boolean;
    } = {},
  ): Promise<RenderedImage> {
    const format = opts.format ?? "png";
    const scale = opts.scale ?? 2;
    const query =
      format === "svg"
        ? `format=svg`
        : `format=png&scale=${scale}`;
    const contentsOnly = opts.contentsOnly ?? true;
    const res = await this.#get<ImagesResponse>(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&${query}` +
        `&contents_only=${contentsOnly}`,
    );
    const url = res.images[nodeId];
    if (!url) {
      throw new FigmaNodeNotFoundError(fileKey, nodeId);
    }
    const imgRes = await this.#fetchRetrying(url);
    if (!imgRes.ok) {
      throw new FigmaApiError(
        imgRes.status,
        `figma: failed to download rendered image for '${nodeId}' (${imgRes.status})`,
      );
    }
    return { bytes: new Uint8Array(await imgRes.arrayBuffer()), url };
  }
}
