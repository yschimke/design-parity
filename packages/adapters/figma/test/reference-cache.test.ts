import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ReferenceCache,
  ReferenceCacheWriter,
  cacheEntryDir,
  nodeDirName,
  readReferenceCacheDoc,
  REFERENCE_CACHE_FORMAT_VERSION,
  REFERENCE_CACHE_INDEX,
} from "../src/reference-cache.js";

const FILE = "AbCdEf123456";

const node = (id: string) => ({
  document: { id, name: `Node ${id}`, type: "FRAME" as const },
});

const svg = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`,
);

/** An 8-byte PNG signature is enough: nothing here decodes it. */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ref-cache-"));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("ReferenceCacheWriter", () => {
  it("round-trips a node through the manifest and back", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: svg, format: "svg" },
    });
    await writer.write();

    const cache = await ReferenceCache.open(root);
    expect(cache).toBeDefined();
    const entry = cache!.entry(FILE, "1:42");
    expect(entry).toMatchObject({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      image: `${FILE}/1-42/image.svg`,
      imageFormat: "svg",
    });
    expect((await cache!.node(FILE, "1:42"))?.document.id).toBe("1:42");
    expect(await readFile(cache!.path(entry!.image!))).toEqual(Buffer.from(svg));
  });

  it("uses a filesystem-safe directory for a colon-bearing node id", () => {
    expect(nodeDirName("1:42")).toBe("1-42");
    expect(cacheEntryDir(FILE, "1:42")).toBe(`${FILE}/1-42`);
  });

  it("refreshes in place, leaving untouched entries exactly as they were", async () => {
    const root = await dir();
    const first = await ReferenceCacheWriter.open(root);
    first.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    for (const id of ["1:1", "1:2"]) {
      await first.put({
        fileKey: FILE,
        nodeId: id,
        fileVersion: "v1",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        node: node(id),
        image: { bytes: svg, format: "svg" },
      });
    }
    await first.write();

    // A later import that only got to one of the two.
    const second = await ReferenceCacheWriter.open(root);
    second.setFile(FILE, { version: "v2", fetchedAt: "2026-02-01T00:00:00.000Z" });
    await second.put({
      fileKey: FILE,
      nodeId: "1:1",
      fileVersion: "v2",
      fetchedAt: "2026-02-01T00:00:00.000Z",
      node: node("1:1"),
      image: { bytes: svg, format: "svg" },
    });
    await second.write();

    const cache = await ReferenceCache.open(root);
    expect(cache!.entry(FILE, "1:1")?.fileVersion).toBe("v2");
    // The one that was not refreshed keeps its OLD version and timestamp — that
    // is what makes it stale, and therefore next run's oldest.
    expect(cache!.entry(FILE, "1:2")).toMatchObject({
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await exists(cache!.path(`${FILE}/1-2/image.svg`))).toBe(true);
  });

  it("sorts entries and files so the committed diff is stable", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    for (const [key, id] of [
      ["ZZZ", "9:9"],
      ["AAA", "2:2"],
      ["AAA", "1:1"],
    ] as const) {
      writer.setFile(key, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
      await writer.put({
        fileKey: key,
        nodeId: id,
        fileVersion: "v1",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        node: node(id),
      });
    }
    const doc = await writer.write();
    expect(doc.entries.map((e) => `${e.fileKey}/${e.nodeId}`)).toEqual([
      "AAA/1:1",
      "AAA/2:2",
      "ZZZ/9:9",
    ]);
    expect(Object.keys(doc.files)).toEqual(["AAA", "ZZZ"]);
  });

  it("records a node with no image, so a failed render doesn't lose the structure", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    const entry = await writer.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
    });
    expect(entry.image).toBeUndefined();
  });

  it("prunes dropped nodes and their blobs, and forgets an emptied file", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    writer.setFile("Other", { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.put({
      fileKey: FILE,
      nodeId: "1:1",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:1"),
      image: { bytes: svg, format: "svg" },
    });
    await writer.put({
      fileKey: "Other",
      nodeId: "2:2",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("2:2"),
      image: { bytes: svg, format: "svg" },
    });

    const dropped = await writer.prune(new Set([`${FILE}/1:1`]));
    await writer.write();

    expect(dropped).toEqual(["Other/2:2"]);
    expect(await exists(join(root, "Other"))).toBe(false);
    expect(Object.keys(writer.doc.files)).toEqual([FILE]);
    expect(await exists(join(root, FILE, "1-1", "image.svg"))).toBe(true);
  });

  it("removes the superseded render when a node switches format", async () => {
    // The whole of issue #441: `put` writes `image.<format>`, so a re-import
    // under a different format left both files on disk in a COMMITTED
    // directory, only one of them named by the index.
    const root = await dir();
    const first = await ReferenceCacheWriter.open(root);
    first.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await first.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: png, format: "png" },
    });
    await first.write();
    expect(await exists(join(root, FILE, "1-42", "image.png"))).toBe(true);

    const second = await ReferenceCacheWriter.open(root);
    const entry = await second.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v2",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: svg, format: "svg" },
    });
    // Still there while only the in-memory manifest knows: a run that dies here
    // leaves index.json naming a file that still exists.
    expect(await exists(join(root, FILE, "1-42", "image.png"))).toBe(true);

    await second.write();
    expect(entry.image).toBe(`${FILE}/1-42/image.svg`);
    expect(await exists(join(root, FILE, "1-42", "image.svg"))).toBe(true);
    expect(await exists(join(root, FILE, "1-42", "image.png"))).toBe(false);
  });

  it("leaves the render alone when a node is re-put at the same format", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    for (const version of ["v1", "v2"]) {
      await writer.put({
        fileKey: FILE,
        nodeId: "1:42",
        fileVersion: version,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        node: node("1:42"),
        image: { bytes: svg, format: "svg" },
      });
    }
    await writer.write();
    expect(await exists(join(root, FILE, "1-42", "image.svg"))).toBe(true);
  });

  it("keeps the old render when a re-put carries no image at all", async () => {
    // A structure fetch that succeeded where the render did not. The entry no
    // longer names the render, but nothing has replaced it either, and the
    // import's own retry is what decides its fate — not the writer.
    const root = await dir();
    const first = await ReferenceCacheWriter.open(root);
    first.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await first.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: png, format: "png" },
    });
    await first.write();

    const second = await ReferenceCacheWriter.open(root);
    await second.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v2",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      node: node("1:42"),
    });
    await second.write();
    expect(await exists(join(root, FILE, "1-42", "image.png"))).toBe(true);
  });

  it("will not follow a manifest path that points outside the cache", async () => {
    // A cache directory is committed, so its index.json is editable by anyone.
    // A traversal path in one is a corrupt cache, not an instruction.
    const root = await dir();
    const outside = join(root, "..", `escape-${Date.now()}.png`);
    await writeFile(outside, "do not delete me");

    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: png, format: "png" },
    });
    await writer.write();
    // Rewrite the manifest the way a tampered-with cache would carry it, then
    // reopen and switch format so that path becomes the superseded one.
    const manifest = JSON.parse(
      await readFile(join(root, REFERENCE_CACHE_INDEX), "utf8"),
    );
    manifest.entries[0].image = `../${outside.split("/").pop()}`;
    await writeFile(
      join(root, REFERENCE_CACHE_INDEX),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    const second = await ReferenceCacheWriter.open(root);
    await second.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v2",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      node: node("1:42"),
      image: { bytes: svg, format: "svg" },
    });
    await second.write();
    expect(await exists(outside)).toBe(true);
  });

  it("keeps a file's variables path across a refresh of its metadata", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.putVariables(FILE, { meta: { variables: {}, variableCollections: {} } });
    writer.setFile(FILE, { version: "v2", fetchedAt: "2026-02-01T00:00:00.000Z" });
    await writer.write();

    const cache = await ReferenceCache.open(root);
    expect(cache!.file(FILE)).toMatchObject({ version: "v2", variables: `${FILE}/variables.json` });
    expect(await cache!.variables(FILE)).toEqual({
      meta: { variables: {}, variableCollections: {} },
    });
  });
});

describe("readReferenceCacheDoc", () => {
  it("is undefined for an absent, unparseable, or non-manifest directory", async () => {
    const root = await dir();
    expect(await readReferenceCacheDoc(root)).toBeUndefined();
    await writeFile(join(root, REFERENCE_CACHE_INDEX), "{not json");
    expect(await readReferenceCacheDoc(root)).toBeUndefined();
    await writeFile(join(root, REFERENCE_CACHE_INDEX), JSON.stringify({ hello: 1 }));
    expect(await readReferenceCacheDoc(root)).toBeUndefined();
  });

  it("refuses a cache written by a newer format rather than half-reading it", async () => {
    const root = await dir();
    await writeFile(
      join(root, REFERENCE_CACHE_INDEX),
      JSON.stringify({
        formatVersion: REFERENCE_CACHE_FORMAT_VERSION + 1,
        files: {},
        entries: [],
      }),
    );
    expect(await readReferenceCacheDoc(root)).toBeUndefined();
  });
});

describe("ReferenceCache reads", () => {
  it("degrades to structure-only tokens when a file has no variables", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.write();
    const cache = await ReferenceCache.open(root);
    expect(await cache!.variables(FILE)).toEqual({});
  });

  it("is undefined for a node whose blob went missing under it", async () => {
    const root = await dir();
    const writer = await ReferenceCacheWriter.open(root);
    writer.setFile(FILE, { version: "v1", fetchedAt: "2026-01-01T00:00:00.000Z" });
    await writer.put({
      fileKey: FILE,
      nodeId: "1:42",
      fileVersion: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      node: node("1:42"),
    });
    await writer.write();
    await writeFile(join(root, FILE, "1-42", "node.json"), "{truncated");

    const cache = await ReferenceCache.open(root);
    expect(await cache!.node(FILE, "1:42")).toBeUndefined();
  });
});
