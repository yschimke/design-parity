import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterContext, CanvasTarget } from "@design-parity/core";

import { FigmaCanvasWriter } from "../src/index.js";
import type { CanvasFetch } from "../src/canvas-writer.js";
import { FigmaAuthError, FigmaError } from "../src/errors.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const target = (uri: string): CanvasTarget => ({
  componentId: "ui/Button.kt#Primary",
  source: "figma",
  ref: "figma:AbC123/1:42",
  image: { state: "default", theme: "dark", uri, width: 24, height: 24 },
});

describe("FigmaCanvasWriter", () => {
  it("POSTs the candidate PNG + target node to the bridge and returns the url", async () => {
    let captured: { input: string; init: Parameters<CanvasFetch>[1] } | undefined;
    const fetch: CanvasFetch = async (input, init) => {
      captured = { input, init };
      return jsonResponse({ url: "https://figma.com/file/AbC123?node-id=1-42" });
    };
    const writer = new FigmaCanvasWriter({
      endpoint: "https://bridge.example/push",
      token: "secret",
      fetch,
    });

    // A `data:` URI candidate so no disk read is needed.
    const dataUri = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
    const ctx: AdapterContext = { repoRoot: "/repo", env: {} };
    const result = await writer.write(target(dataUri), ctx);

    expect(captured?.input).toBe("https://bridge.example/push");
    expect(captured?.init.method).toBe("POST");
    expect(captured?.init.headers.Authorization).toBe("Bearer secret");
    const sent = JSON.parse(captured!.init.body) as Record<string, unknown>;
    expect(sent.fileKey).toBe("AbC123");
    expect(sent.nodeId).toBe("1:42");
    expect(sent.componentId).toBe("ui/Button.kt#Primary");
    expect(sent.theme).toBe("dark");
    expect(sent.png).toBe(Buffer.from(PNG_BYTES).toString("base64"));
    expect(result.url).toContain("figma.com");
  });

  it("reads a repo-relative PNG path from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "canvas-writer-"));
    try {
      await writeFile(join(dir, "a.png"), PNG_BYTES);
      let body: Record<string, unknown> | undefined;
      const fetch: CanvasFetch = async (_input, init) => {
        body = JSON.parse(init.body) as Record<string, unknown>;
        return jsonResponse({});
      };
      const writer = new FigmaCanvasWriter({ endpoint: "https://b/x", fetch });
      const ctx: AdapterContext = { repoRoot: dir, env: {} };
      await writer.write(target("a.png"), ctx);
      expect(body!.png).toBe(Buffer.from(PNG_BYTES).toString("base64"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to FIGMA_CANVAS_ENDPOINT / tokens from the context env", async () => {
    let auth: string | undefined;
    const fetch: CanvasFetch = async (input, init) => {
      auth = init.headers.Authorization;
      expect(input).toBe("https://env-bridge/x");
      return jsonResponse({});
    };
    const writer = new FigmaCanvasWriter({ fetch });
    const dataUri = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
    const ctx: AdapterContext = {
      repoRoot: "/repo",
      env: { FIGMA_CANVAS_ENDPOINT: "https://env-bridge/x", FIGMA_OAUTH_TOKEN: "oauth" },
    };
    await writer.write(target(dataUri), ctx);
    expect(auth).toBe("Bearer oauth");
  });

  it("throws a clear error when no endpoint is configured", async () => {
    const writer = new FigmaCanvasWriter({ fetch: async () => jsonResponse({}) });
    const ctx: AdapterContext = { repoRoot: "/repo", env: {} };
    await expect(writer.write(target("data:image/png;base64,AA=="), ctx)).rejects.toThrow(
      /no Code-to-Canvas endpoint/i,
    );
  });

  it("maps 401/403 to FigmaAuthError", async () => {
    const fetch: CanvasFetch = async () =>
      new Response("nope", { status: 403 });
    const writer = new FigmaCanvasWriter({ endpoint: "https://b/x", fetch });
    const ctx: AdapterContext = { repoRoot: "/repo", env: {} };
    await expect(
      writer.write(target("data:image/png;base64,AA=="), ctx),
    ).rejects.toBeInstanceOf(FigmaAuthError);
  });

  it("rejects a non-figma target", async () => {
    const writer = new FigmaCanvasWriter({ endpoint: "https://b/x" });
    const ctx: AdapterContext = { repoRoot: "/repo", env: {} };
    const bad = { ...target("data:image/png;base64,AA=="), source: "stitch" as const };
    await expect(writer.write(bad, ctx)).rejects.toBeInstanceOf(FigmaError);
  });
});
