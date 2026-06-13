/**
 * The Figma {@link CanvasWriter}: pushes a candidate render back onto the Figma
 * canvas (Code-to-Canvas, issue #9) — the `code-led`, Figma-only stretch.
 *
 * The Figma **REST** API is read-only: it can render a node to an image, but it
 * cannot place an image back into a file. So a real write goes through a
 * companion **Code-to-Canvas bridge** — a Figma plugin or Dev Mode endpoint that
 * accepts the candidate PNG + the target node and updates the canvas. This class
 * is the thin HTTP client for that bridge, with `fetch` injectable so unit tests
 * run offline (mirroring {@link FigmaRestClient}).
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  AdapterContext,
  CanvasTarget,
  CanvasWriteResult,
  CanvasWriter,
} from "@design-parity/core";

import { FigmaApiError, FigmaAuthError, FigmaError } from "./errors.js";
import { parseFigmaRef } from "./figma-ref.js";

/** POST-capable fetch (the read client's `FetchLike` only models GETs). */
export type CanvasFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

export interface FigmaCanvasWriterOptions {
  /**
   * The Code-to-Canvas bridge endpoint (a Figma plugin / Dev Mode hook). Falls
   * back to `FIGMA_CANVAS_ENDPOINT` from the adapter context env.
   */
  endpoint?: string;
  /**
   * Bearer token for the bridge. Falls back to `FIGMA_CANVAS_TOKEN`, then
   * `FIGMA_OAUTH_TOKEN`, from the adapter context env.
   */
  token?: string;
  /** Injectable fetch. Defaults to `globalThis.fetch`. */
  fetch?: CanvasFetch;
}

/** The JSON the bridge replies with (all fields optional). */
interface BridgeResponse {
  url?: string;
  nodeId?: string;
}

/** Read a candidate image's bytes from a `data:` URI or a repo-relative path. */
async function loadPng(uri: string, repoRoot: string): Promise<Uint8Array> {
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    const payload = comma >= 0 ? uri.slice(comma + 1) : "";
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  const path = isAbsolute(uri) ? uri : resolve(repoRoot, uri);
  return new Uint8Array(await readFile(path));
}

export class FigmaCanvasWriter implements CanvasWriter {
  readonly source = "figma" as const;
  readonly #opts: FigmaCanvasWriterOptions;

  constructor(opts: FigmaCanvasWriterOptions = {}) {
    this.#opts = opts;
  }

  async write(
    target: CanvasTarget,
    ctx: AdapterContext,
  ): Promise<CanvasWriteResult> {
    if (target.source !== "figma") {
      throw new FigmaError(
        "bad-ref",
        `figma: canvas writer cannot push a '${target.source}' target`,
      );
    }

    const endpoint = this.#opts.endpoint ?? ctx.env.FIGMA_CANVAS_ENDPOINT;
    if (!endpoint) {
      throw new FigmaError(
        "api",
        "figma: no Code-to-Canvas endpoint — set FIGMA_CANVAS_ENDPOINT or pass options.endpoint",
      );
    }

    const { fileKey, nodeId } = parseFigmaRef(target.ref);
    const png = await loadPng(target.image.uri, ctx.repoRoot);

    const fetchImpl =
      this.#opts.fetch ?? (globalThis.fetch as CanvasFetch | undefined);
    if (!fetchImpl) {
      throw new FigmaError("api", "figma: no fetch available; pass one via options.fetch");
    }

    const token =
      this.#opts.token ?? ctx.env.FIGMA_CANVAS_TOKEN ?? ctx.env.FIGMA_OAUTH_TOKEN;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const { image } = target;
    const body = JSON.stringify({
      fileKey,
      nodeId,
      componentId: target.componentId,
      state: image.state,
      ...(image.theme ? { theme: image.theme } : {}),
      ...(image.size ? { size: image.size } : {}),
      width: image.width,
      height: image.height,
      png: Buffer.from(png).toString("base64"),
    });

    const res = await fetchImpl(endpoint, { method: "POST", headers, body });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new FigmaAuthError(
          `figma: Code-to-Canvas bridge rejected credentials (${res.status})${detail ? ` — ${detail}` : ""}`,
        );
      }
      throw new FigmaApiError(
        res.status,
        `figma: Code-to-Canvas write failed (${res.status}) for ${fileKey}/${nodeId}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as BridgeResponse;
    const result: CanvasWriteResult = { detail: `updated ${fileKey}/${nodeId}` };
    if (json.url) result.url = json.url;
    return result;
  }
}

/** Convenience factory. */
export function createFigmaCanvasWriter(
  opts: FigmaCanvasWriterOptions = {},
): FigmaCanvasWriter {
  return new FigmaCanvasWriter(opts);
}
