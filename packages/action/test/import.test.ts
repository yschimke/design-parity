/**
 * The import's contract (issue #289): one request decides whether the rest are
 * needed, the oldest thing goes first, and nothing is lost because a request
 * failed.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FigmaRateLimitError,
  FigmaRestClient,
  ReferenceCache,
  type FetchLike,
} from "@design-parity/adapter-figma";
import type { DesignMap } from "@design-parity/core";

import {
  figmaContentsOnlyByNodeOf,
  figmaRefsOf,
  importReferences,
  importTargets,
  refreshOrder,
} from "../src/import.js";

const FILE = "AbCdEf123456";
const BASE = "https://api.test";

const nodeDoc = (id: string) => ({
  id,
  name: `Node ${id}`,
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
  });
}

interface FakeOptions {
  version?: string;
  /** Node ids the API refuses to render, and how. */
  imageFails?: Record<string, "429" | "500">;
  /** Fail every `/nodes` request. */
  structureFails?: boolean;
}

/** A fake Figma that records every path it was asked for. */
function fakeFigma(opts: FakeOptions = {}): { fetch: FetchLike; paths: string[] } {
  const paths: string[] = [];
  const version = opts.version ?? "v1";
  const fetch: FetchLike = async (url) => {
    paths.push(url.replace(BASE, ""));
    if (url.includes("?depth=1")) {
      return json({ name: "Kit", lastModified: "2026-01-01T00:00:00Z", version });
    }
    if (url.includes("/variables/local")) return json({});
    if (url.includes("/nodes?")) {
      if (opts.structureFails) return new Response("boom", { status: 500 });
      const ids = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "").split(",");
      const nodes: Record<string, unknown> = {};
      for (const id of ids) nodes[id] = { document: nodeDoc(id) };
      return json({ nodes });
    }
    if (url.includes("/v1/images/")) {
      const id = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "");
      const failure = opts.imageFails?.[id];
      if (failure === "429") {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      if (failure === "500") return new Response("boom", { status: 500 });
      return json({ err: null, images: { [id]: `https://img.test/${id}.svg` } });
    }
    return new Response(svg);
  };
  return { fetch, paths };
}

function client(fetch: FetchLike): FigmaRestClient {
  // One attempt: this suite asserts what the import does with a failure, not
  // how patiently the client retries first (rest-client.test.ts covers that).
  return new FigmaRestClient({ token: "tok", baseUrl: BASE, fetch, attempts: 1 });
}

async function cacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dp-import-"));
}

const at = (iso: string) => () => new Date(iso);

describe("figmaRefsOf", () => {
  it("collects every figma ref, variants and component sets included", () => {
    const map: DesignMap = {
      components: [
        { code: "a/A.kt#A", source: "figma", ref: `figma:${FILE}/1:1` },
        {
          code: "b/B.kt#B",
          source: "figma",
          ref: [
            { ref: `figma:${FILE}/2:2`, theme: "light" },
            { ref: `figma:${FILE}/3:3`, theme: "dark" },
          ],
          refSet: `figma:${FILE}/4:4`,
        },
        { code: "c/C.kt#C", source: "stitch", ref: "stitch:proj/x" },
        // A duplicate reference is one node, not two.
        { code: "d/D.kt#D", source: "figma", ref: `figma:${FILE}/1:1` },
      ],
    };
    expect(figmaRefsOf(map)).toEqual([
      `figma:${FILE}/1:1`,
      `figma:${FILE}/2:2`,
      `figma:${FILE}/3:3`,
      `figma:${FILE}/4:4`,
    ]);
    expect(figmaRefsOf(undefined)).toEqual([]);
  });

  it("collects per-reference export modes while component sets keep the fallback", () => {
    const map: DesignMap = {
      components: [
        {
          code: "a/A.kt#A",
          source: "figma",
          ref: `figma:${FILE}/1:1`,
          refSet: `figma:${FILE}/9:9`,
          referenceContentsOnly: false,
        },
        { code: "b/B.kt#B", source: "figma", ref: `figma:${FILE}/2:2` },
      ],
    };
    expect([...figmaContentsOnlyByNodeOf(map)]).toEqual([
      [`${FILE}/1:1`, false],
      [`${FILE}/9:9`, true],
      [`${FILE}/2:2`, true],
    ]);
  });
});

describe("importTargets", () => {
  it("groups by file and sets aside what only Code Connect can resolve", () => {
    const { byFile, skipped } = importTargets([
      `figma:${FILE}/1:1`,
      `figma:Other/2:2`,
      "ui/Button.kt#Primary",
    ]);
    expect([...byFile.keys()]).toEqual([FILE, "Other"]);
    expect(byFile.get(FILE)).toEqual(["1:1"]);
    expect(skipped).toEqual(["ui/Button.kt#Primary"]);
  });
});

describe("refreshOrder", () => {
  const entry = (nodeId: string, fileVersion: string, fetchedAt: string) => ({
    fileKey: FILE,
    nodeId,
    fileVersion,
    fetchedAt,
    node: "n",
    image: "i",
  });

  it("puts never-fetched nodes first, then the oldest", () => {
    const entries = new Map([
      ["1:1", entry("1:1", "v0", "2026-03-01T00:00:00Z")],
      ["1:2", entry("1:2", "v0", "2026-01-01T00:00:00Z")],
    ]);
    expect(
      refreshOrder(["1:1", "1:2", "1:3"], (id) => entries.get(id), "v1", false),
    ).toEqual(["1:3", "1:2", "1:1"]);
  });

  it("holds back nodes already at the current version, unless forced", () => {
    const entries = new Map([["1:1", entry("1:1", "v1", "2026-01-01T00:00:00Z")]]);
    expect(refreshOrder(["1:1"], (id) => entries.get(id), "v1", false)).toEqual([]);
    expect(refreshOrder(["1:1"], (id) => entries.get(id), "v1", true)).toEqual(["1:1"]);
  });

  it("re-queues a current entry when the contents-only mode changes", () => {
    const entries = new Map([
      [
        "1:1",
        {
          ...entry("1:1", "v1", "2026-01-01T00:00:00Z"),
          imageContentsOnly: true,
        },
      ],
    ]);
    expect(
      refreshOrder(["1:1"], (id) => entries.get(id), "v1", false, false),
    ).toEqual(["1:1"]);
  });

  it("re-queues an entry that has structure but no image", () => {
    const half = { ...entry("1:1", "v1", "2026-01-01T00:00:00Z"), image: undefined };
    expect(refreshOrder(["1:1"], () => half, "v1", false)).toEqual(["1:1"]);
  });
});

describe("importReferences", () => {
  it("fetches, writes, and records the file version it saw", async () => {
    const dir = await cacheDir();
    const { fetch, paths } = fakeFigma();
    const result = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`, `figma:${FILE}/1:2`],
      client: client(fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ refreshed: 2, failed: 0, complete: true });
    const cache = await ReferenceCache.open(dir);
    expect(cache!.entries).toHaveLength(2);
    expect(cache!.file(FILE)).toMatchObject({ version: "v1", lastModified: "2026-01-01T00:00:00Z" });
    // Two structures in ONE request, not one each.
    expect(paths.filter((p) => p.includes("/nodes?"))).toHaveLength(1);
  });

  it("costs one request when the file version has not moved", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`, `figma:${FILE}/1:2`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    const second = fakeFigma();
    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(second.fetch),
      now: at("2026-02-01T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ refreshed: 0, carried: 2, unchanged: [FILE], complete: true });
    expect(second.paths).toEqual([`/v1/files/${FILE}?depth=1`]);
    // The entries keep the timestamps they were fetched with — an untouched row
    // must not look freshly imported.
    const cache = await ReferenceCache.open(dir);
    expect(cache!.entry(FILE, "1:1")?.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refreshes only the node whose per-reference mode includes overlapping layers", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`, `figma:${FILE}/1:2`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    const second = fakeFigma();
    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(second.fetch),
      now: at("2026-02-01T00:00:00.000Z"),
      imageContentsOnlyByNode: new Map([[`${FILE}/1:1`, false]]),
    });

    expect(result.refreshed).toBe(1);
    expect(
      new URL(BASE + second.paths.find((p) => p.includes("/v1/images/"))).searchParams.get(
        "contents_only",
      ),
    ).toBe("false");
    expect((await ReferenceCache.open(dir))!.entry(FILE, "1:1")?.imageContentsOnly).toBe(false);
    expect((await ReferenceCache.open(dir))!.entry(FILE, "1:2")?.imageContentsOnly).toBe(true);

    const third = fakeFigma();
    const unchanged = await importReferences({
      cacheDir: dir,
      refs,
      client: client(third.fetch),
      now: at("2026-03-01T00:00:00.000Z"),
      imageContentsOnlyByNode: new Map([[`${FILE}/1:1`, false]]),
    });
    expect(unchanged).toMatchObject({ refreshed: 0, unchanged: [FILE] });
    expect(third.paths).toEqual([`/v1/files/${FILE}?depth=1`]);
  });

  it("re-reads every node once the file version moves", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma({ version: "v1" }).fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });
    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma({ version: "v2" }).fetch),
      now: at("2026-02-01T00:00:00.000Z"),
    });

    expect(result.refreshed).toBe(1);
    const cache = await ReferenceCache.open(dir);
    expect(cache!.entry(FILE, "1:1")).toMatchObject({
      fileVersion: "v2",
      fetchedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("keeps the previous entry for a node it could not render, and stays stale", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`, `figma:${FILE}/1:2`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma({ version: "v1" }).fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma({ version: "v2", imageFails: { "1:2": "500" } }).fetch),
      now: at("2026-02-01T00:00:00.000Z"),
      force: true,
    });

    expect(result).toMatchObject({ refreshed: 1, failed: 1, complete: false });
    const cache = await ReferenceCache.open(dir);
    // Refreshed.
    expect(cache!.entry(FILE, "1:1")?.fileVersion).toBe("v2");
    // Carried forward whole — blobs, version and timestamp — so it is still the
    // oldest thing in the cache and refreshes first next time.
    expect(cache!.entry(FILE, "1:2")).toMatchObject({
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      image: `${FILE}/1-2/image.svg`,
    });
  });

  it("stops the file on a rate limit rather than burning the rest of the run", async () => {
    const dir = await cacheDir();
    const refs = ["1:1", "1:2", "1:3"].map((id) => `figma:${FILE}/${id}`);
    const fake = fakeFigma({ imageFails: { "1:1": "429", "1:2": "429", "1:3": "429" } });
    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(fake.fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    expect(result.refreshed).toBe(0);
    expect(result.complete).toBe(false);
    // One image attempt, then it gives up on the file.
    expect(fake.paths.filter((p) => p.includes("/v1/images/"))).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("rate limited"))).toBe(true);
  });

  it("carries a whole file forward when its metadata is unreadable", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    const result = await importReferences({
      cacheDir: dir,
      refs,
      client: client(async () => new Response("nope", { status: 500 })),
      now: at("2026-02-01T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ refreshed: 0, carried: 1, failed: 1, complete: false });
    const cache = await ReferenceCache.open(dir);
    expect(cache!.entry(FILE, "1:1")?.fileVersion).toBe("v1");
  });

  it("refreshes at most `limit` nodes, oldest first, and says it is not done", async () => {
    const dir = await cacheDir();
    const refs = ["1:1", "1:2", "1:3"].map((id) => `figma:${FILE}/${id}`);
    const first = await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
      limit: 2,
    });
    expect(first).toMatchObject({ refreshed: 2, carried: 1, complete: false });

    // The third node is the only one never fetched, so it goes first next time.
    const second = await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-02T00:00:00.000Z"),
      limit: 2,
    });
    expect(second).toMatchObject({ refreshed: 1, complete: true });
    const cache = await ReferenceCache.open(dir);
    expect(cache!.entries).toHaveLength(3);
    expect(cache!.entry(FILE, "1:3")?.fetchedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("does not lose a node's structure to a failed batch", async () => {
    const dir = await cacheDir();
    const result = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fakeFigma({ structureFails: true }).fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ refreshed: 0, failed: 1, complete: false });
    expect(await ReferenceCache.open(dir).then((c) => c!.entries)).toEqual([]);
  });

  it("only prunes when asked to", async () => {
    const dir = await cacheDir();
    const refs = [`figma:${FILE}/1:1`, `figma:${FILE}/1:2`];
    await importReferences({
      cacheDir: dir,
      refs,
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    const kept = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fakeFigma().fetch),
      now: at("2026-02-01T00:00:00.000Z"),
    });
    expect(kept.pruned).toEqual([]);
    expect((await ReferenceCache.open(dir))!.entries).toHaveLength(2);

    const pruned = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fakeFigma().fetch),
      now: at("2026-03-01T00:00:00.000Z"),
      prune: true,
    });
    expect(pruned.pruned).toEqual([`${FILE}/1:2`]);
    expect((await ReferenceCache.open(dir))!.entries).toHaveLength(1);
  });

  it("warns about a ref only Code Connect can resolve, and imports the rest", async () => {
    const dir = await cacheDir();
    const result = await importReferences({
      cacheDir: dir,
      refs: ["ui/Button.kt#Primary", `figma:${FILE}/1:1`],
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });
    expect(result.refreshed).toBe(1);
    expect(result.warnings.some((w) => w.includes("ui/Button.kt#Primary"))).toBe(true);
  });

  it("is a no-op on an empty ref list", async () => {
    const dir = await cacheDir();
    const result = await importReferences({
      cacheDir: dir,
      refs: [],
      client: client(fakeFigma().fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ refreshed: 0, carried: 0, complete: true });
    expect((await ReferenceCache.open(dir))!.entries).toEqual([]);
  });

  it("never throws a source failure at the caller", async () => {
    const dir = await cacheDir();
    await expect(
      importReferences({
        cacheDir: dir,
        refs: [`figma:${FILE}/1:1`],
        client: client(async () => {
          throw new FigmaRateLimitError("figma: rate limited (429)", 1);
        }),
        now: at("2026-01-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ complete: false });
  });
});

/**
 * The structural half (#296). A variant carries neither its properties nor its
 * siblings — both live on the component set — so an import that stores only the
 * variants leaves a cache-only run unable to say what its references depict.
 */
describe("importReferences: component sets", () => {
  const SET = "9:9";

  /** Like `fakeFigma`, but every node reports it is a variant of one set. */
  function kitFigma(): { fetch: FetchLike; paths: string[] } {
    const paths: string[] = [];
    const fetch: FetchLike = async (url) => {
      paths.push(url.replace(BASE, ""));
      if (url.includes("?depth=1")) {
        return json({ name: "Kit", lastModified: "2026-01-01T00:00:00Z", version: "v1" });
      }
      if (url.includes("/variables/local")) return json({});
      if (url.includes("/nodes?")) {
        const ids = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "").split(",");
        const nodes: Record<string, unknown> = {};
        for (const id of ids) {
          nodes[id] =
            id === SET
              ? {
                  document: {
                    ...nodeDoc(id),
                    type: "COMPONENT_SET",
                    componentPropertyDefinitions: {
                      "Show icon#1:0": { type: "BOOLEAN", defaultValue: true },
                    },
                    children: [{ id: "1:1", name: "Size=Small", type: "COMPONENT" }],
                  },
                }
              : {
                  document: nodeDoc(id),
                  components: { [id]: { key: `k-${id}`, name: id, componentSetId: SET } },
                };
        }
        return json({ nodes });
      }
      if (url.includes("/v1/images/")) {
        const id = decodeURIComponent(new URL(url).searchParams.get("ids") ?? "");
        return json({ err: null, images: { [id]: `https://img.test/${id}.svg` } });
      }
      return new Response(svg);
    };
    return { fetch, paths };
  }

  it("caches the set structure-only, and the pointer that finds it", async () => {
    const dir = await cacheDir();
    const { fetch } = kitFigma();
    const result = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ refreshed: 1, sets: 1, complete: true });

    const cache = (await ReferenceCache.open(dir))!;
    const set = cache.entry(FILE, SET)!;
    expect(set).toMatchObject({ structureOnly: true, fileVersion: "v1" });
    expect(set.image).toBeUndefined(); // a render of a set compares against nothing
    // The variant's pointer to its family survives the round trip.
    const variant = await cache.node(FILE, "1:1");
    expect(variant?.components?.["1:1"]?.componentSetId).toBe(SET);
    // …and the set's own document carries the definitions the render used.
    const cachedSet = await cache.node(FILE, SET);
    expect(cachedSet?.document.componentPropertyDefinitions).toBeDefined();
  });

  it("re-reads nothing when the file has not moved", async () => {
    const dir = await cacheDir();
    const { fetch, paths } = kitFigma();
    const opts = {
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    };
    await importReferences(opts);
    const after = paths.length;

    // Same version: the short-circuit fires before the set pass is reached.
    const again = await importReferences(opts);
    expect(again).toMatchObject({ refreshed: 0, sets: 0, unchanged: [FILE], complete: true });
    expect(paths.slice(after)).toEqual([`/v1/files/${FILE}?depth=1`]);
  });

  it("gives a set its render once something references it by name", async () => {
    const dir = await cacheDir();
    const { fetch } = kitFigma();
    // First import knows the set only as a variant's family: structure only.
    await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(fetch),
      now: at("2026-01-01T00:00:00.000Z"),
    });
    expect((await ReferenceCache.open(dir))!.entry(FILE, SET)?.image).toBeUndefined();

    // Then the design map adds it as a `refSet` (#299) — an imageless entry is
    // due, so it is refreshed properly rather than skipped as already cached.
    const result = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`, `figma:${FILE}/${SET}`],
      client: client(fetch),
      now: at("2026-01-02T00:00:00.000Z"),
    });
    expect(result.refreshed).toBe(1);
    expect((await ReferenceCache.open(dir))!.entry(FILE, SET)?.image).toBeDefined();
  });

  it("keeps the reference when the set cannot be read", async () => {
    const dir = await cacheDir();
    const { fetch } = kitFigma();
    let seenSet = false;
    const flaky: FetchLike = async (url, init) => {
      const ids = url.includes("/nodes?")
        ? decodeURIComponent(new URL(url).searchParams.get("ids") ?? "")
        : "";
      if (ids === SET) {
        seenSet = true;
        return new Response("boom", { status: 500 });
      }
      return fetch(url, init);
    };

    const result = await importReferences({
      cacheDir: dir,
      refs: [`figma:${FILE}/1:1`],
      client: client(flaky),
      now: at("2026-01-01T00:00:00.000Z"),
    });

    expect(seenSet).toBe(true);
    expect(result).toMatchObject({ refreshed: 1, sets: 0, complete: true });
    expect((await ReferenceCache.open(dir))!.entry(FILE, "1:1")).toBeDefined();
  });
});
