/**
 * The parity run's half of issue #289: with a committed cache, resolving a
 * reference makes no Figma calls — and under `cacheOnly` it *cannot*.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterContext } from "@design-parity/core";

import { createFigmaAdapter } from "../src/adapter.js";
import { FigmaCacheMissError } from "../src/errors.js";
import { ReferenceCache, ReferenceCacheWriter } from "../src/reference-cache.js";
import type { FetchLike } from "../src/rest-client.js";

const FILE = "AbCdEf123456";
const REF = `figma:${FILE}/1:42`;

const node = {
  document: {
    id: "1:42",
    name: "Button/Primary",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 48 },
    cornerRadius: 8,
    paddingLeft: 16,
    paddingRight: 16,
    fills: [{ type: "SOLID", color: { r: 0.4, g: 0.35, b: 1, a: 1 } }],
  },
};

const svg = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><rect width="160" height="48" rx="8" fill="#645AFF"/></svg>`,
);

const variables = {
  meta: {
    variableCollections: {
      C1: {
        id: "C1",
        name: "Theme",
        defaultModeId: "m-light",
        modes: [{ modeId: "m-light", name: "Light" }],
        variableIds: ["V1"],
      },
    },
    variables: {
      V1: {
        id: "V1",
        name: "container",
        resolvedType: "COLOR",
        valuesByMode: { "m-light": { r: 0.4, g: 0.35, b: 1, a: 1 } },
      },
    },
  },
};

/** Builds a cache holding `1:42`, and returns its directory. */
async function seedCache(withImage = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "figma-refcache-"));
  const writer = await ReferenceCacheWriter.open(dir);
  writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
  await writer.putVariables(FILE, variables);
  await writer.put({
    fileKey: FILE,
    nodeId: "1:42",
    fileVersion: "v1",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    node,
    ...(withImage ? { image: { bytes: svg, format: "svg" as const } } : {}),
  });
  await writer.write();
  return dir;
}

let calls: string[];
/** Any call at all is a failure of the point being made, so record and refuse. */
const forbiddenFetch: FetchLike = async (url) => {
  calls.push(url);
  throw new Error(`unexpected network call: ${url}`);
};

beforeEach(() => {
  calls = [];
});

// No token: a run reading the cache has no reason to hold Figma credentials,
// and requiring them would make the cache a network dependency in disguise.
const ctx: AdapterContext = { repoRoot: process.cwd(), env: {} };

describe("FigmaAdapter with a committed reference cache", () => {
  it("resolves a reference without a single request", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const adapter = createFigmaAdapter({
      cache: cache!,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });

    const reference = await adapter.resolve("ui/Button.kt#Primary", REF, ctx);

    expect(calls).toEqual([]);
    expect(reference.ref).toBe(REF);
    expect(reference.tokens?.radius).toMatchObject({ corner: 8 });
    // Dimensions come from the cached bytes, not from a re-render.
    expect(reference.referenceImages).toHaveLength(1);
    expect(reference.referenceImages[0]).toMatchObject({ width: 160, height: 48 });
    expect(reference.referenceImages[0]!.uri).toBe(cache!.path(`${FILE}/1-42/image.svg`));
    // Variables were imported alongside the node, so the palette is present.
    expect(reference.themeTokens).toBeDefined();
  });

  it("prefetch is a no-op when the cache is the only source", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const adapter = createFigmaAdapter({
      cache: cache!,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });
    await adapter.prefetch([REF, `figma:${FILE}/9:99`], ctx);
    expect(calls).toEqual([]);
  });

  it("names the missing node, and says how to get it, rather than failing obscurely", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const adapter = createFigmaAdapter({
      cache: cache!,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });

    await expect(
      adapter.resolve("ui/Card.kt#Card", `figma:${FILE}/9:99`, ctx),
    ).rejects.toThrowError(FigmaCacheMissError);
    await expect(
      adapter.resolve("ui/Card.kt#Card", `figma:${FILE}/9:99`, ctx),
    ).rejects.toThrow(/design-parity import/);
    expect(calls).toEqual([]);
  });

  it("treats a structure-only entry as a miss under cacheOnly", async () => {
    const cache = await ReferenceCache.open(await seedCache(false));
    const adapter = createFigmaAdapter({
      cache: cache!,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });
    await expect(adapter.resolve("ui/Button.kt#Primary", REF, ctx)).rejects.toThrow(
      /no rendered image/,
    );
  });

  it("falls back to the API for a miss when the cache is only a preference", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      if (url.includes("/nodes?")) {
        return new Response(JSON.stringify({ nodes: { "9:99": node } }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/variables/local")) {
        return new Response(JSON.stringify(variables), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/images/")) {
        return new Response(JSON.stringify({ err: null, images: { "9:99": "https://img.test/a.svg" } }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(svg);
    };

    const outDir = await mkdtemp(join(tmpdir(), "figma-out-"));
    const adapter = createFigmaAdapter({
      cache: cache!,
      fetch: fetchImpl,
      baseUrl: "https://api.test",
      outDir,
    });

    // The cached node still costs nothing…
    await adapter.resolve("ui/Button.kt#Primary", REF, ctx as AdapterContext);
    expect(seen).toEqual([]);

    // …and the uncached one is fetched exactly as it was before the cache existed.
    const fresh = await adapter.resolve(
      "ui/Card.kt#Card",
      `figma:${FILE}/9:99`,
      { repoRoot: process.cwd(), env: { FIGMA_TOKEN: "tok" } },
    );
    expect(fresh.referenceImages).toHaveLength(1);
    expect(seen.some((u) => u.includes("/nodes?"))).toBe(true);
  });

  // `parseFigmaRef` throws on a ref only Code Connect can resolve. Letting that
  // escape abandoned the warm for every OTHER ref in the list, putting the run
  // back to one request per component — the cost prefetch exists to remove.
  it("warms the parseable refs even when the list holds a Code Connect handle", async () => {
    const seen: string[] = [];
    const adapter = createFigmaAdapter({
      baseUrl: "https://api.test",
      fetch: async (url) => {
        seen.push(url);
        return new Response(JSON.stringify({ nodes: {} }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await adapter.prefetch(["ui/Button.kt#Primary", REF], {
      repoRoot: process.cwd(),
      env: { FIGMA_TOKEN: "tok" },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("1%3A42");
  });

  it("skips cached ids when warming, so a warm only asks for what is missing", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const seen: string[] = [];
    const adapter = createFigmaAdapter({
      cache: cache!,
      baseUrl: "https://api.test",
      fetch: async (url) => {
        seen.push(url);
        return new Response(JSON.stringify({ nodes: {} }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    await adapter.prefetch([REF, `figma:${FILE}/9:99`], {
      repoRoot: process.cwd(),
      env: { FIGMA_TOKEN: "tok" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("9%3A99");
    expect(seen[0]).not.toContain("1%3A42");
  });
});

describe("the adapter acts on the context's density (#375)", () => {
  // The cached node states a 16 padding and an 8 corner in the board's own
  // pixels. At 2× those are an 8dp inset and a 4dp corner in the code's units,
  // and comparing the raw numbers against a render that already resolved dp is
  // the twofold divergence `DesignMapEntry.density` exists to prevent.
  it("converts a cached capture into the code's units", async () => {
    const cache = await ReferenceCache.open(await seedCache());
    const adapter = createFigmaAdapter({
      cache,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });

    const reference = await adapter.resolve("ui/Button.kt#Primary", REF, {
      ...ctx,
      density: 2,
    });

    expect(reference.tokens?.spacing).toMatchObject({ padding: 8 });
    expect(reference.tokens?.radius).toMatchObject({ corner: 4 });

    // No layout to stamp: `layoutFromNode` needs at least one labelled, bounded
    // DESCENDANT, and this cached node is childless. Worth pinning, because it
    // is the same shape as the open question on #371 — a reference whose
    // captured node has no children carries no geometry at all, and every
    // geometry-dependent check downstream is then silently inert. The
    // stamping itself is covered in `normalize.test.ts`, over a node with one.
    expect(reference.layout).toBeUndefined();
  });

  it("leaves the capture as-is when the context states no density", async () => {
    // Guard the guard: the assertions above only mean something while the
    // unscaled resolve really does report the board's own numbers.
    const cache = await ReferenceCache.open(await seedCache());
    const adapter = createFigmaAdapter({
      cache,
      cacheOnly: true,
      fetch: forbiddenFetch,
    });

    const reference = await adapter.resolve("ui/Button.kt#Primary", REF, ctx);

    expect(reference.tokens?.spacing).toMatchObject({ padding: 16 });
    expect(reference.tokens?.radius).toMatchObject({ corner: 8 });
  });
});
