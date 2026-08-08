/**
 * The adapter side of issue #296: a reference must say what it depicts, and
 * "the same component, one axis moved" must be a lookup rather than a guess.
 *
 * `componentPropertyDefinitions` is returned **only for nodes asked for
 * directly**, and a variant's definitions live on its component *set* — so both
 * behaviours hang off a second, batched read of the sets, which these tests
 * pin (including its request count, since the whole point is not paying it per
 * component).
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { AdapterContext } from "@design-parity/core";

import { createFigmaAdapter } from "../src/adapter.js";
import { ReferenceCache, ReferenceCacheWriter } from "../src/reference-cache.js";
import type { FetchLike } from "../src/rest-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

const BASE = "https://api.test";
const FILE = "AbCdEf123456";
const SET = "10:1";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><rect width="160" height="48" fill="#645AFF"/></svg>`;

/** The set: two axes plus a `Show icon` default the variant names never state. */
const setNode = {
  id: SET,
  name: "Button",
  type: "COMPONENT_SET",
  componentPropertyDefinitions: {
    Size: {
      type: "VARIANT",
      defaultValue: "Small",
      variantOptions: ["Small", "Medium"],
    },
    "Show icon#5590:0": { type: "BOOLEAN", defaultValue: true },
  },
  children: [
    { id: "10:2", name: "Size=Small, State=Enabled", type: "COMPONENT" },
    { id: "10:3", name: "Size=Medium, State=Enabled", type: "COMPONENT" },
    { id: "10:4", name: "Size=Small, State=Disabled", type: "COMPONENT" },
  ],
};

const variants: Record<string, { id: string; name: string }> = {
  "10:2": { id: "10:2", name: "Size=Small, State=Enabled" },
  "10:3": { id: "10:3", name: "Size=Medium, State=Enabled" },
  "10:4": { id: "10:4", name: "Size=Small, State=Disabled" },
};

function jsonRes(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A file whose nodes are the set's variants. Every variant's response carries
 * the `components` map with its `componentSetId` — that pointer is the only
 * route from a node to the family that owns its properties.
 */
function kitFetch(): { fetch: FetchLike; nodeRequests: string[][] } {
  const nodeRequests: string[][] = [];
  const fetch: FetchLike = async (url) => {
    if (url.includes("/variables/local")) return jsonRes({});
    if (url.includes("/nodes?")) {
      const ids = decodeURIComponent(
        new URL(url).searchParams.get("ids") ?? "",
      ).split(",");
      nodeRequests.push(ids);
      const nodes: Record<string, unknown> = {};
      for (const id of ids) {
        if (id === SET) {
          nodes[id] = { document: setNode };
          continue;
        }
        const variant = variants[id];
        if (!variant) continue;
        nodes[id] = {
          document: { ...variant, type: "COMPONENT" },
          components: {
            [id]: { key: `k-${id}`, name: variant.name, componentSetId: SET },
          },
        };
      }
      return jsonRes({ nodes });
    }
    if (url.includes("/v1/images/")) {
      const id = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "");
      return jsonRes({ err: null, images: { [id]: "https://img.test/a.svg" } });
    }
    if (url === "https://img.test/a.svg") return new Response(svg);
    return new Response("not found", { status: 404 });
  };
  return { fetch, nodeRequests };
}

const ctx: AdapterContext = { repoRoot, env: { FIGMA_TOKEN: "tok" } };

async function outDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "figma-props-"));
}

describe("component properties on the reference", () => {
  it("states what the render depicts, including the silent boolean default", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE, outDir: await outDir() });

    const reference = await adapter.resolve(
      "ui/Button.kt#SmallButton",
      `figma:${FILE}/10:2`,
      ctx,
    );

    expect(reference.properties).toEqual([
      { name: "Show icon", type: "boolean", value: "true" },
      { name: "Size", type: "variant", value: "Small", options: ["Small", "Medium"] },
    ]);
  });

  it("leaves `properties` absent when the node's file exposes none", async () => {
    const plain: FetchLike = async (url) => {
      if (url.includes("/variables/local")) return jsonRes({});
      if (url.includes("/nodes?"))
        return jsonRes({
          nodes: { "1:1": { document: { id: "1:1", name: "Frame", type: "FRAME" } } },
        });
      if (url.includes("/v1/images/"))
        return jsonRes({ err: null, images: { "1:1": "https://img.test/a.svg" } });
      if (url === "https://img.test/a.svg") return new Response(svg);
      return new Response("not found", { status: 404 });
    };
    const adapter = createFigmaAdapter({
      fetch: plain,
      baseUrl: BASE,
      outDir: await outDir(),
    });
    const reference = await adapter.resolve("ui/X.kt#X", `figma:${FILE}/1:1`, ctx);
    expect(reference.properties).toBeUndefined();
  });

  it("reads every set ONCE for the whole run, in one batched request", async () => {
    const { fetch, nodeRequests } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE, outDir: await outDir() });

    const refs = ["10:2", "10:3", "10:4"].map((id) => `figma:${FILE}/${id}`);
    await adapter.prefetch(refs, ctx);
    for (const ref of refs) await adapter.resolve(`ui/B.kt#${ref}`, ref, ctx);

    // One request for the three nodes, one for the single set they share, and
    // nothing more — resolving never re-asks for either.
    expect(nodeRequests).toEqual([["10:2", "10:3", "10:4"], [SET]]);
  });

  it("still resolves properties when prefetch never ran", async () => {
    const { fetch, nodeRequests } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE, outDir: await outDir() });

    const reference = await adapter.resolve(
      "ui/Button.kt#SmallButton",
      `figma:${FILE}/10:2`,
      ctx,
    );

    expect(reference.properties?.map((p) => p.name)).toEqual(["Show icon", "Size"]);
    expect(nodeRequests).toEqual([["10:2"], [SET]]); // the node, then its set
  });

  it("degrades to no properties when the set read fails, rather than failing the reference", async () => {
    const { fetch } = kitFetch();
    const flaky: FetchLike = async (url, init) => {
      const ids = url.includes("/nodes?")
        ? decodeURIComponent(new URL(url).searchParams.get("ids") ?? "")
        : "";
      if (ids === SET) return new Response("nope", { status: 500 });
      return fetch(url, init);
    };
    const adapter = createFigmaAdapter({
      fetch: flaky,
      baseUrl: BASE,
      outDir: await outDir(),
      attempts: 1,
    });

    const reference = await adapter.resolve(
      "ui/Button.kt#SmallButton",
      `figma:${FILE}/10:2`,
      ctx,
    );
    expect(reference.properties).toBeUndefined();
    expect(reference.referenceImages).toHaveLength(1);
  });
});

describe("resolveSibling", () => {
  it("moves one axis and finds the sibling that carries it", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "Size", value: "Medium" }, ctx),
    ).resolves.toBe(`figma:${FILE}/10:3`);
  });

  it("matches the axis name case-insensitively (the consumer's spelling)", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "size", value: "Medium" }, ctx),
    ).resolves.toBe(`figma:${FILE}/10:3`);
  });

  it("holds every other axis fixed", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE });

    // Size=Small,State=Disabled → Size=Medium would be Size=Medium,State=Disabled,
    // which this set does not have. Nothing, rather than the Enabled one.
    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:4`, { axis: "Size", value: "Medium" }, ctx),
    ).resolves.toBeUndefined();
  });

  it("finds nothing for a value the set does not have", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "Size", value: "Jumbo" }, ctx),
    ).resolves.toBeUndefined();
  });

  it("finds nothing for an axis the component does not have", async () => {
    const { fetch } = kitFetch();
    const adapter = createFigmaAdapter({ fetch, baseUrl: BASE });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "Density", value: "Compact" }, ctx),
    ).resolves.toBeUndefined();
  });

  it("finds nothing for a node that is not a variant, and never throws", async () => {
    const missing: FetchLike = async (url) =>
      url.includes("/nodes?")
        ? jsonRes({ nodes: { "1:1": null } })
        : new Response("not found", { status: 404 });
    const adapter = createFigmaAdapter({ fetch: missing, baseUrl: BASE });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/1:1`, { axis: "Size", value: "Medium" }, ctx),
    ).resolves.toBeUndefined();
    await expect(
      adapter.resolveSibling("ui/Button.kt#X", { axis: "Size", value: "Medium" }, ctx),
    ).resolves.toBeUndefined();
  });
});

/**
 * The structural half of the reference cache (#296 folding into #289). A
 * cache-only run is now the recommended parity path, so if properties lived
 * only behind a live API call, the silent-icon failure this issue is about
 * would come straight back for every cached run.
 */
describe("component properties from a committed cache", () => {
  const cached = { document: { ...variants["10:2"]!, type: "COMPONENT" } };

  async function seed(withSet: boolean): Promise<ReferenceCache> {
    const dir = await mkdtemp(join(tmpdir(), "figma-props-cache-"));
    const writer = await ReferenceCacheWriter.open(dir);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.put({
      fileKey: FILE,
      nodeId: "10:2",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: {
        ...cached,
        components: {
          "10:2": { key: "k", name: cached.document.name, componentSetId: SET },
        },
      },
      image: { bytes: new TextEncoder().encode(svg), format: "svg" },
    });
    if (withSet) {
      await writer.put({
        fileKey: FILE,
        nodeId: SET,
        fileVersion: "v1",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        node: { document: setNode as never },
        structureOnly: true,
      });
    }
    await writer.write();
    return (await ReferenceCache.open(dir))!;
  }

  const offline: AdapterContext = { repoRoot, env: {} };
  const forbidden: FetchLike = async (url) => {
    throw new Error(`unexpected network call: ${url}`);
  };

  it("says what the reference depicts without a single request", async () => {
    const adapter = createFigmaAdapter({
      cache: await seed(true),
      cacheOnly: true,
      fetch: forbidden,
    });

    const reference = await adapter.resolve("ui/Button.kt#Small", `figma:${FILE}/10:2`, offline);

    expect(reference.properties).toEqual([
      { name: "Show icon", type: "boolean", value: "true" },
      { name: "Size", type: "variant", value: "Small", options: ["Small", "Medium"] },
    ]);
  });

  it("resolves a sibling from the cached set, offline", async () => {
    const adapter = createFigmaAdapter({
      cache: await seed(true),
      cacheOnly: true,
      fetch: forbidden,
    });

    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "Size", value: "Medium" }, offline),
    ).resolves.toBe(`figma:${FILE}/10:3`);
  });

  it("degrades quietly on a cache written before sets were stored", async () => {
    const adapter = createFigmaAdapter({
      cache: await seed(false),
      cacheOnly: true,
      fetch: forbidden,
    });

    const reference = await adapter.resolve("ui/Button.kt#Small", `figma:${FILE}/10:2`, offline);
    expect(reference.properties).toBeUndefined();
    await expect(
      adapter.resolveSibling(`figma:${FILE}/10:2`, { axis: "Size", value: "Medium" }, offline),
    ).resolves.toBeUndefined();
  });
});
