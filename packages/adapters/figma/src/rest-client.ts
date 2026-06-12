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
}

export interface RenderedImage {
  bytes: Uint8Array;
  /** The signed URL the bytes were downloaded from (trace/debug). */
  url: string;
}

export class FigmaRestClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #authHeaders: Record<string, string>;

  constructor(opts: FigmaRestClientOptions) {
    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error("figma: no fetch available; pass one via options.fetch");
    }
    this.#fetch = fetchImpl;
    this.#baseUrl = (opts.baseUrl ?? "https://api.figma.com").replace(/\/$/, "");

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

  async #get<T>(path: string): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
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
        `figma: rate limited (429) for ${path}`,
        Number.isFinite(retry) ? retry : undefined,
      );
    }
    throw new FigmaApiError(
      res.status,
      `figma: request failed (${res.status}) for ${path}${body ? ` — ${body}` : ""}`,
    );
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

  /** `GET /v1/images/:key?ids=&format=png&scale=` then download the result. */
  async renderImage(
    fileKey: string,
    nodeId: string,
    opts: { scale?: number } = {},
  ): Promise<RenderedImage> {
    const scale = opts.scale ?? 2;
    const res = await this.#get<ImagesResponse>(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    );
    const url = res.images[nodeId];
    if (!url) {
      throw new FigmaNodeNotFoundError(fileKey, nodeId);
    }
    const imgRes = await this.#fetch(url);
    if (!imgRes.ok) {
      throw new FigmaApiError(
        imgRes.status,
        `figma: failed to download rendered image for '${nodeId}' (${imgRes.status})`,
      );
    }
    return { bytes: new Uint8Array(await imgRes.arrayBuffer()), url };
  }
}
