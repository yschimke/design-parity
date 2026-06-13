/**
 * Production transport for {@link DaemonDataClient}: the compose-ai-tools daemon
 * over **stdio**, speaking LSP-framed JSON-RPC 2.0 (compose-ai-tools
 * `docs/daemon/PROTOCOL.md`, v2). Spawn it via e.g.
 * `compose-preview bundle daemon <bundle>` (Android previews additionally need
 * the Android daemon sidecar; see that command's help).
 *
 * The framing codec ({@link encodeFrame} / {@link FrameDecoder}) and the
 * RPC correlation layer ({@link JsonRpcConnection}) are split out from process
 * spawning so they unit-test over in-memory streams with no daemon. The
 * handshake is: `initialize` (protocolVersion 2) → `extensions/enable` (opt in
 * to the data-product kinds) → per preview `renderNow` then await the
 * `renderFinished` notification (png + attached data products) → `data/fetch`
 * for anything not attached. Depends only on `@design-parity/core` + Node.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { DaemonDataClient, DaemonImage } from "./daemon.js";
import { readPngSize } from "./png.js";

// ---------------------------------------------------------------------------
// LSP framing codec.
// ---------------------------------------------------------------------------

/** Encode a JSON-RPC message as an LSP `Content-Length` frame. */
export function encodeFrame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(
    `Content-Length: ${json.byteLength}\r\n\r\n`,
    "ascii",
  );
  return Buffer.concat([header, json]);
}

/**
 * Incremental decoder for LSP `Content-Length` frames. Feed it stdout chunks;
 * it returns zero or more fully-parsed JSON messages per chunk and buffers the
 * remainder. `Content-Length` is mandatory and counts UTF-8 bytes.
 */
export class FrameDecoder {
  #buf = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const sep = this.#buf.indexOf("\r\n\r\n");
      if (sep === -1) break;
      const header = this.#buf.subarray(0, sep).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Unparseable header — drop it and resync past the separator.
        this.#buf = this.#buf.subarray(sep + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = sep + 4;
      if (this.#buf.byteLength < start + len) break; // wait for the body
      const body = this.#buf.subarray(start, start + len).toString("utf8");
      this.#buf = this.#buf.subarray(start + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        // Skip a malformed body rather than wedging the stream.
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC correlation over a generic byte transport.
// ---------------------------------------------------------------------------

/** The minimal duplex byte transport a {@link JsonRpcConnection} drives. */
export interface ByteTransport {
  write(frame: Buffer): void;
  onData(handler: (chunk: Buffer) => void): void;
  onClose(handler: () => void): void;
}

type Pending = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

/** A JSON-RPC 2.0 client connection: id-correlated requests + notifications. */
export class JsonRpcConnection {
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();
  readonly #notify = new Map<string, ((params: unknown) => void)[]>();
  readonly #decoder = new FrameDecoder();
  #closed = false;

  constructor(private readonly transport: ByteTransport) {
    transport.onData((chunk) => {
      for (const msg of this.#decoder.push(chunk)) this.#dispatch(msg);
    });
    transport.onClose(() => {
      this.#closed = true;
      const err = new Error("daemon connection closed");
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    });
  }

  /** Send a request and resolve with its `result` (or reject on `error`/close). */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("connection closed"));
    const id = this.#nextId++;
    const frame = encodeFrame({ jsonrpc: "2.0", id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.transport.write(frame);
    });
  }

  /** Fire-and-forget notification (no id, no response). */
  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    this.transport.write(encodeFrame({ jsonrpc: "2.0", method, params }));
  }

  /** Subscribe to a server notification method. Returns an unsubscribe fn. */
  on(method: string, handler: (params: unknown) => void): () => void {
    const list = this.#notify.get(method) ?? [];
    list.push(handler);
    this.#notify.set(method, list);
    return () => {
      const cur = this.#notify.get(method);
      if (cur) this.#notify.set(method, cur.filter((h) => h !== handler));
    };
  }

  #dispatch(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    if (typeof m.id === "number" && (m.result !== undefined || m.error !== undefined)) {
      const pending = this.#pending.get(m.id);
      if (!pending) return;
      this.#pending.delete(m.id);
      if (m.error) pending.reject(new Error(m.error.message ?? `rpc error ${m.error.code}`));
      else pending.resolve(m.result);
      return;
    }
    if (typeof m.method === "string") {
      for (const h of this.#notify.get(m.method) ?? []) h(m.params);
    }
  }
}

// ---------------------------------------------------------------------------
// The stdio daemon client.
// ---------------------------------------------------------------------------

export interface StdioDaemonOptions {
  /** Executable to spawn, e.g. `"compose-preview"`. */
  command: string;
  /** Args, e.g. `["bundle", "daemon", "/path/bundle.png"]`. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  clientVersion?: string;
  workspaceRoot: string;
  moduleId: string;
  moduleProjectDir: string;
  /** Data-product kinds to `extensions/enable`. Defaults to the a11y/i18n set. */
  enableKinds?: string[];
  /** ms to await a `renderFinished` after `renderNow` (default 120000). */
  renderTimeoutMs?: number;
}

interface RenderState {
  pngPath?: string;
  /** Inline `kind → payload` attached on `renderFinished`. */
  attached: Map<string, unknown>;
}

const DEFAULT_KINDS = [
  "a11y/atf",
  "a11y/hierarchy",
  "a11y/touchTargets",
  "text/strings",
  "i18n/translations",
];

/**
 * A {@link DaemonDataClient} backed by a spawned compose-ai-tools daemon over
 * stdio. Call {@link start} once before use and {@link close} when done.
 *
 * Live use needs a daemon that can render the target previews — for an Android
 * bundle that requires the Android daemon sidecar (see
 * `compose-preview bundle daemon` help). The transport itself is backend-
 * agnostic.
 */
export class StdioDaemonClient implements DaemonDataClient {
  #proc?: ChildProcessWithoutNullStreams;
  #conn?: JsonRpcConnection;
  #started = false;
  readonly #renders = new Map<string, RenderState>();

  constructor(private readonly opts: StdioDaemonOptions) {}

  /** Spawn the daemon, handshake (`initialize` + `extensions/enable`). */
  async start(): Promise<void> {
    if (this.#started) return;
    const proc = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.#proc = proc;

    const transport: ByteTransport = {
      write: (frame) => proc.stdin.write(frame),
      onData: (h) => proc.stdout.on("data", h),
      onClose: (h) => proc.on("exit", h),
    };
    const conn = new JsonRpcConnection(transport);
    this.#conn = conn;

    // renderFinished carries the png + any attached data products.
    conn.on("renderFinished", (params) => this.#onRenderFinished(params));

    await conn.request("initialize", {
      protocolVersion: 2,
      clientVersion: this.opts.clientVersion ?? "design-parity",
      workspaceRoot: this.opts.workspaceRoot,
      moduleId: this.opts.moduleId,
      moduleProjectDir: this.opts.moduleProjectDir,
      capabilities: { visibility: true, metrics: false },
    });
    await conn
      .request("extensions/enable", { ids: this.opts.enableKinds ?? DEFAULT_KINDS })
      .catch(() => undefined); // best-effort: a daemon may auto-enable
    this.#started = true;
  }

  #onRenderFinished(params: unknown): void {
    const p = params as {
      id?: string;
      pngPath?: string;
      dataProducts?: Array<{ kind?: string; payload?: unknown }>;
    };
    if (!p?.id) return;
    const state: RenderState = this.#renders.get(p.id) ?? { attached: new Map() };
    if (p.pngPath) state.pngPath = p.pngPath;
    for (const dp of p.dataProducts ?? []) {
      if (dp.kind && dp.payload !== undefined) state.attached.set(dp.kind, dp.payload);
    }
    this.#renders.set(p.id, state);
  }

  /** Render a preview and resolve once its `renderFinished` lands. */
  async #render(previewId: string): Promise<RenderState | undefined> {
    const conn = this.#conn;
    if (!conn) throw new Error("StdioDaemonClient.start() not called");
    const existing = this.#renders.get(previewId);
    if (existing?.pngPath) return existing;

    const timeoutMs = this.opts.renderTimeoutMs ?? 120_000;
    const done = new Promise<RenderState>((resolve, reject) => {
      const off = conn.on("renderFinished", (params) => {
        if ((params as { id?: string })?.id === previewId) {
          off();
          clearTimeout(timer);
          resolve(this.#renders.get(previewId)!);
        }
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`render timed out for '${previewId}'`));
      }, timeoutMs);
    });

    const queued = (await conn.request("renderNow", {
      previews: [previewId],
      tier: "fast",
    })) as { queued?: string[]; rejected?: Array<{ id: string; reason: string }> };
    const rejected = queued?.rejected?.find((r) => r.id === previewId);
    if (rejected) throw new Error(`daemon rejected '${previewId}': ${rejected.reason}`);
    return done;
  }

  async image(previewId: string): Promise<DaemonImage | undefined> {
    const state = await this.#render(previewId);
    if (!state?.pngPath) return undefined;
    const bytes = new Uint8Array(await readFile(state.pngPath));
    const { width, height } = readPngSize(bytes);
    return {
      uri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      width,
      height,
    };
  }

  async fetch(previewId: string, kind: string): Promise<unknown | undefined> {
    const conn = this.#conn;
    if (!conn) throw new Error("StdioDaemonClient.start() not called");
    await this.#render(previewId);

    // Prefer the payload attached on renderFinished; else data/fetch.
    const attached = this.#renders.get(previewId)?.attached.get(kind);
    if (attached !== undefined) return attached;

    let result: { payload?: unknown; path?: string; bytes?: string } | undefined;
    try {
      result = (await conn.request("data/fetch", { previewId, kind })) as typeof result;
    } catch {
      return undefined; // DataProductUnknown / NotAvailable — degrade gracefully
    }
    if (!result) return undefined;
    if (result.payload !== undefined) return result.payload;
    if (result.path) {
      try {
        return JSON.parse(await readFile(result.path, "utf8"));
      } catch {
        return undefined;
      }
    }
    if (result.bytes) {
      try {
        return JSON.parse(Buffer.from(result.bytes, "base64").toString("utf8"));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Best-effort graceful shutdown (`shutdown` + `exit`), then kill. */
  async close(): Promise<void> {
    const conn = this.#conn;
    if (conn) {
      await conn.request("shutdown").catch(() => undefined);
      conn.notify("exit");
    }
    this.#proc?.kill();
    this.#started = false;
  }
}
