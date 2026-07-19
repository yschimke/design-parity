import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterContext, DesignReference } from "@design-parity/core";

import { createFigmaAdapter } from "../src/adapter.js";
import {
  FigmaAuthError,
  FigmaRateLimitError,
  FigmaNodeNotFoundError,
} from "../src/errors.js";
import type { FetchLike } from "../src/rest-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

const BASE = "https://api.test";
const FILE = "AbCdEf123456";

// Structure node the /nodes endpoint returns — padding/radius/fills/text.
const node = {
  id: "1:42",
  name: "Button/Primary",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 48 },
  cornerRadius: 8,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 14,
  paddingBottom: 14,
  fills: [{ type: "SOLID", color: { r: 100 / 255, g: 90 / 255, b: 1, a: 1 } }],
  children: [
    {
      id: "1:99",
      name: "Label",
      type: "TEXT",
      characters: "Continue",
      style: { fontFamily: "Roboto", fontSize: 14, fontWeight: 500, lineHeightPx: 20 },
      styles: { text: "S:body-large" },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
  ],
};

// File-level published-style metadata returned alongside the node.
const styles = {
  "S:body-large": { key: "abc", name: "Body/Large", styleType: "TEXT" },
};

// Variables endpoint — a Theme collection with Light/Dark modes.
const variables = {
  meta: {
    variableCollections: {
      C1: {
        id: "C1",
        name: "Theme",
        defaultModeId: "m-light",
        modes: [
          { modeId: "m-light", name: "Light" },
          { modeId: "m-dark", name: "Dark" },
        ],
        variableIds: ["V1"],
      },
      C2: {
        id: "C2",
        name: "Scale",
        defaultModeId: "m-base",
        modes: [{ modeId: "m-base", name: "Mode 1" }],
        variableIds: ["V2", "V3", "V4"],
      },
    },
    variables: {
      V1: {
        id: "V1",
        name: "container",
        resolvedType: "COLOR",
        valuesByMode: {
          "m-light": { r: 100 / 255, g: 90 / 255, b: 1, a: 1 },
          "m-dark": { r: 138 / 255, g: 130 / 255, b: 1, a: 1 },
        },
      },
      V2: {
        id: "V2",
        name: "radius/medium",
        resolvedType: "FLOAT",
        valuesByMode: { "m-base": 8 },
      },
      V3: {
        id: "V3",
        name: "space/large",
        resolvedType: "FLOAT",
        valuesByMode: { "m-base": 24 },
      },
      // Unhinted FLOAT — left out of the scale rather than mis-classified.
      V4: {
        id: "V4",
        name: "elevation/raised",
        resolvedType: "FLOAT",
        valuesByMode: { "m-base": 3 },
      },
    },
  },
};

function jsonRes(obj: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

let lightPng: Uint8Array;
let darkPng: Uint8Array;

beforeAll(async () => {
  lightPng = new Uint8Array(
    await readFile(resolve(repoRoot, "fixtures/figma/button-primary.light.png")),
  );
  darkPng = new Uint8Array(
    await readFile(resolve(repoRoot, "fixtures/figma/button-primary.dark.png")),
  );
});

// A 160×48 vector reference (the adapter now imports SVG by default).
const svg160x48 = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><rect width="160" height="48" rx="8" fill="${fill}"/></svg>`;

/** Happy-path fetch: structure, variables, and a light/dark image each. */
const okFetch: FetchLike = async (url) => {
  if (url.includes("/variables/local")) return jsonRes(variables);
  if (url.includes("/nodes?")) return jsonRes({ nodes: { "1:42": { document: node, styles } } });
  const fmt = url.includes("format=svg") ? "svg" : "png";
  if (url.includes("/v1/images/") && url.includes("1%3A42"))
    return jsonRes({ err: null, images: { "1:42": `https://img.test/light.${fmt}` } });
  if (url.includes("/v1/images/") && url.includes("1%3A43"))
    return jsonRes({ err: null, images: { "1:43": `https://img.test/dark.${fmt}` } });
  if (url === "https://img.test/light.png") return new Response(lightPng);
  if (url === "https://img.test/dark.png") return new Response(darkPng);
  if (url === "https://img.test/light.svg") return new Response(svg160x48("#645AFF"));
  if (url === "https://img.test/dark.svg") return new Response(svg160x48("#8A82FF"));
  return new Response("not found", { status: 404 });
};

async function ctx(): Promise<AdapterContext> {
  return { repoRoot, env: { FIGMA_TOKEN: "tok" } };
}

const targets = [
  { nodeId: "1:42", state: "default", theme: "light" as const, size: "compact" },
  { nodeId: "1:43", state: "default", theme: "dark" as const, size: "compact" },
];

describe("FigmaAdapter.resolve (happy path)", () => {
  let result: DesignReference;

  beforeAll(async () => {
    const outDir = await mkdtemp(join(tmpdir(), "figma-out-"));
    const adapter = createFigmaAdapter({
      fetch: okFetch,
      baseUrl: BASE,
      outDir,
      resolveTargets: () => targets,
    });
    result = await adapter.resolve("ui/Button.kt#PrimaryButton", "figma:AbCdEf123456/1:42", await ctx());
  });

  it("normalizes identity + link method", () => {
    expect(result.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(result.source).toBe("figma");
    expect(result.linkMethod).toBe("code-connect");
    expect(result.ref).toBe("figma:AbCdEf123456/1:42");
  });

  it("matches the golden fixture's tokens", async () => {
    const golden = JSON.parse(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.reference.json"), "utf8"),
    ) as DesignReference;
    expect(result.tokens).toEqual(golden.tokens);
    // The Variables palette is the design-system table, separate from per-node tokens.
    expect(result.themeTokens).toEqual(golden.themeTokens);
  });

  it("produces a light + dark image with the golden variants and real dims", async () => {
    const golden = JSON.parse(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.reference.json"), "utf8"),
    ) as DesignReference;

    const shape = (img: DesignReference["referenceImages"][number]) => ({
      state: img.state,
      theme: img.theme,
      size: img.size,
      width: img.width,
      height: img.height,
    });
    expect(result.referenceImages.map(shape)).toEqual(
      golden.referenceImages.map(shape),
    );

    // every rendered image was actually written to disk, as a vector .svg
    for (const img of result.referenceImages) {
      await expect(access(img.uri)).resolves.toBeUndefined();
      expect(img.uri.endsWith(".svg")).toBe(true);
    }
  });
});

describe("FigmaAdapter.resolve (png format override)", () => {
  it("keeps the legacy PNG raster import when imageFormat is 'png'", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "figma-out-png-"));
    let requestedFormat: string | undefined;
    const spyFetch: FetchLike = async (url, init) => {
      if (url.includes("/v1/images/")) requestedFormat = /format=(\w+)/.exec(url)?.[1];
      return okFetch(url, init);
    };
    const adapter = createFigmaAdapter({
      fetch: spyFetch,
      baseUrl: BASE,
      outDir,
      imageFormat: "png",
      resolveTargets: () => [targets[0]!],
    });
    const result = await adapter.resolve(
      "ui/Button.kt#PrimaryButton",
      "figma:AbCdEf123456/1:42",
      await ctx(),
    );
    expect(requestedFormat).toBe("png");
    expect(result.referenceImages[0]!.uri.endsWith(".png")).toBe(true);
    expect(result.referenceImages[0]).toMatchObject({ width: 160, height: 48 });
  });
});

describe("FigmaAdapter.resolve (errors)", () => {
  it("rejects with FigmaAuthError when no token is configured", async () => {
    const adapter = createFigmaAdapter({ fetch: okFetch, baseUrl: BASE });
    await expect(
      adapter.resolve("c#C", "figma:KEY/1:1", { repoRoot, env: {} }),
    ).rejects.toBeInstanceOf(FigmaAuthError);
  });

  it("maps 403 to FigmaAuthError", async () => {
    const f: FetchLike = async () => new Response("Forbidden", { status: 403 });
    const adapter = createFigmaAdapter({ fetch: f, baseUrl: BASE });
    await expect(adapter.resolve("c#C", "figma:KEY/1:1", await ctx())).rejects.toBeInstanceOf(
      FigmaAuthError,
    );
  });

  it("maps 429 to FigmaRateLimitError with retry-after", async () => {
    const f: FetchLike = async () =>
      new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    const adapter = createFigmaAdapter({ fetch: f, baseUrl: BASE });
    await expect(
      adapter.resolve("c#C", "figma:KEY/1:1", await ctx()),
    ).rejects.toBeInstanceOf(FigmaRateLimitError);
    await expect(adapter.resolve("c#C", "figma:KEY/1:1", await ctx())).rejects.toMatchObject({
      code: "rate-limit",
      retryAfterSeconds: 30,
    });
  });

  it("maps a missing node to FigmaNodeNotFoundError", async () => {
    const f: FetchLike = async (url) =>
      url.includes("/nodes?") ? jsonRes({ nodes: { "1:1": null } }) : new Response("{}");
    const adapter = createFigmaAdapter({ fetch: f, baseUrl: BASE });
    await expect(adapter.resolve("c#C", "figma:KEY/1:1", await ctx())).rejects.toBeInstanceOf(
      FigmaNodeNotFoundError,
    );
  });

  it("treats a null rendered image as a missing node", async () => {
    const f: FetchLike = async (url) => {
      if (url.includes("/variables/local")) return jsonRes(variables);
      if (url.includes("/nodes?")) return jsonRes({ nodes: { "1:42": { document: node, styles } } });
      if (url.includes("/v1/images/")) return jsonRes({ err: null, images: { "1:42": null } });
      return new Response("{}");
    };
    const adapter = createFigmaAdapter({ fetch: f, baseUrl: BASE });
    await expect(
      adapter.resolve("ui/Button.kt#PrimaryButton", "figma:AbCdEf123456/1:42", await ctx()),
    ).rejects.toBeInstanceOf(FigmaNodeNotFoundError);
  });
});
