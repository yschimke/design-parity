import { describe, it, expect } from "vitest";

import {
  encodeFrame,
  FrameDecoder,
  JsonRpcConnection,
  StdioDaemonClient,
  type ByteTransport,
} from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("LSP framing codec", () => {
  it("round-trips a message through encode → decode", () => {
    const frame = encodeFrame({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(frame.toString("ascii", 0, 16)).toContain("Content-Length:");
    const decoder = new FrameDecoder();
    expect(decoder.push(frame)).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
    ]);
  });

  it("reassembles a frame split across chunks and yields multiple per chunk", () => {
    const a = encodeFrame({ id: 1 });
    const b = encodeFrame({ id: 2 });
    const decoder = new FrameDecoder();
    // split the first frame mid-body
    const cut = Math.floor(a.byteLength / 2);
    expect(decoder.push(a.subarray(0, cut))).toEqual([]);
    expect(decoder.push(Buffer.concat([a.subarray(cut), b]))).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const decoder = new FrameDecoder();
    const [msg] = decoder.push(encodeFrame({ s: "héllo — €" }));
    expect(msg).toEqual({ s: "héllo — €" });
  });
});

/** An in-memory transport pair: what the client writes is fed to a fake server. */
function fakeTransport(): {
  transport: ByteTransport;
  /** Frames the client has written (decoded). */
  sent: unknown[];
  /** Push a server→client message. */
  serverSend: (msg: unknown) => void;
  serverClose: () => void;
} {
  let onData: ((c: Buffer) => void) | undefined;
  let onClose: (() => void) | undefined;
  const sent: unknown[] = [];
  const decoder = new FrameDecoder();
  return {
    sent,
    transport: {
      write: (frame) => {
        for (const m of decoder.push(frame)) sent.push(m);
      },
      onData: (h) => {
        onData = h;
      },
      onClose: (h) => {
        onClose = h;
      },
    },
    serverSend: (msg) => onData?.(encodeFrame(msg)),
    serverClose: () => onClose?.(),
  };
}

describe("JsonRpcConnection", () => {
  it("correlates a response to its request by id", async () => {
    const f = fakeTransport();
    const conn = new JsonRpcConnection(f.transport);
    const p = conn.request("initialize", { protocolVersion: 2 });
    // the client wrote a request with id 1
    expect(f.sent[0]).toMatchObject({ id: 1, method: "initialize" });
    f.serverSend({ jsonrpc: "2.0", id: 1, result: { daemonVersion: "x" } });
    await expect(p).resolves.toEqual({ daemonVersion: "x" });
  });

  it("rejects on an error response", async () => {
    const f = fakeTransport();
    const conn = new JsonRpcConnection(f.transport);
    const p = conn.request("data/fetch");
    f.serverSend({ jsonrpc: "2.0", id: 1, error: { code: -32020, message: "DataProductUnknown" } });
    await expect(p).rejects.toThrow("DataProductUnknown");
  });

  it("dispatches notifications to subscribers", () => {
    const f = fakeTransport();
    const conn = new JsonRpcConnection(f.transport);
    const seen: unknown[] = [];
    conn.on("renderFinished", (p) => seen.push(p));
    f.serverSend({ jsonrpc: "2.0", method: "renderFinished", params: { id: "X", pngPath: "/p.png" } });
    f.serverSend({ jsonrpc: "2.0", method: "ignored", params: {} });
    expect(seen).toEqual([{ id: "X", pngPath: "/p.png" }]);
  });

  it("rejects pending requests when the connection closes", async () => {
    const f = fakeTransport();
    const conn = new JsonRpcConnection(f.transport);
    const p = conn.request("initialize");
    f.serverClose();
    await expect(p).rejects.toThrow(/closed/);
  });
});

describe("StdioDaemonClient handshake", () => {
  type Frame = { method?: string; id?: number; params?: { ids?: string[] } };

  function newClient(f: ReturnType<typeof fakeTransport>): StdioDaemonClient {
    return new StdioDaemonClient({
      command: "compose-preview",
      workspaceRoot: "/repo",
      moduleId: ":app",
      moduleProjectDir: "/repo/app",
      enableKinds: ["compose/theme", "a11y/atf"],
      transportFactory: () => f.transport,
    });
  }

  // Regression guard for #55, found driving a live daemon: two handshake bugs
  // the fake-transport unit tests didn't model.
  //
  // 1. A live daemon rejects `renderNow` with NotInitialized unless the client
  //    sends the `initialized` notification after the `initialize` response and
  //    before any further request.
  // 2. `extensions/enable` opts in by **extension id**, not data-product kind —
  //    so the client must resolve its desired kinds to owning extension ids via
  //    `extensions/list` first. Passing kinds directly enables nothing.
  it("sends initialized, then enables extensions by id resolved from kinds", async () => {
    const f = fakeTransport();
    const client = newClient(f);

    const started = client.start();
    // initialize (id 1) is written synchronously — respond, then let each
    // awaited request's continuation run before answering the next.
    f.serverSend({ jsonrpc: "2.0", id: 1, result: { daemonVersion: "x" } });
    await tick();
    // extensions/list (id 2): data/theme owns compose/theme; a11y owns a11y/atf;
    // render/trace owns a kind we didn't ask for and must be left alone.
    f.serverSend({
      jsonrpc: "2.0",
      id: 2,
      result: {
        extensions: [
          { id: "data/theme", dataProductKinds: ["compose/theme"] },
          { id: "a11y", dataProductKinds: ["a11y/atf", "a11y/hierarchy"] },
          { id: "render/trace", dataProductKinds: ["render/trace"] },
        ],
      },
    });
    await tick();
    f.serverSend({ jsonrpc: "2.0", id: 3, result: { newlyEnabled: [] } }); // enable
    await started;

    const frames = f.sent as Frame[];
    expect(frames.map((m) => m.method)).toEqual([
      "initialize",
      "initialized",
      "extensions/list",
      "extensions/enable",
    ]);
    // `initialized` is a notification — no id.
    expect(frames.find((m) => m.method === "initialized")?.id).toBeUndefined();
    // Enable is called with the owning extension *ids*, not the kinds, and only
    // for the kinds we asked for (render/trace is excluded).
    const enable = frames.find((m) => m.method === "extensions/enable");
    expect(enable?.params?.ids).toEqual(["data/theme", "a11y"]);
  });
});
