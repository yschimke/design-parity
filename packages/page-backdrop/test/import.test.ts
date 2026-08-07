import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import type { PageBackdropConfig } from "../src/config.js";
import type { PageDocument, PageFetcher, PageNode } from "../src/fetcher.js";
import { MANIFEST_FILENAME, importPages, parseManifest, writeImport } from "../src/import.js";

const FILE = "AbCdEf123456";

function pageDoc(name: string, children: PageNode[]): PageDocument {
  return {
    document: {
      id: "1:1",
      name,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 720 },
      children,
    },
    components: { "10:5": { name: "Primary", componentSetId: "10:1" } },
  };
}

/** An offline fetcher: a canned tree per node id, and deterministic "PNG" bytes. */
function fakeFetcher(pages: Record<string, PageDocument>): PageFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchPage(_fileKey, nodeId) {
      calls.push(`fetch:${nodeId}`);
      const doc = pages[nodeId];
      if (!doc) throw new Error(`no fake page for ${nodeId}`);
      return doc;
    },
    async renderPage(_fileKey, nodeId, scale) {
      calls.push(`render:${nodeId}@${scale}`);
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, nodeId.length, scale]);
    },
  };
}

const config = (over: Partial<PageBackdropConfig> = {}): PageBackdropConfig => ({
  source: "figma",
  fileKey: FILE,
  pages: [{ nodeId: "1:2" }],
  scale: 2,
  nested: false,
  outDir: "/unused",
  overlay: { enabled: false, opacity: 0.5, blend: "normal" },
  configPath: "/repo/design-pages.json",
  ...over,
});

const button = (id: string, y: number): PageNode => ({
  id,
  name: "Button/Primary",
  type: "INSTANCE",
  componentId: "10:5",
  absoluteBoundingBox: { x: 20, y, width: 200, height: 48 },
});

describe("importPages", () => {
  it("builds a manifest with linked placements and the backdrop bytes", async () => {
    const fetcher = fakeFetcher({ "1:2": pageDoc("Now Playing", [button("2:1", 100)]) });
    const result = await importPages({
      config: config(),
      fetcher,
      inputs: { codeConnect: { "ui/Button.kt#PrimaryButton": `figma:${FILE}/10:1` } },
    });

    expect(result.manifest).toMatchObject({
      version: 1,
      source: "figma",
      fileKey: FILE,
    });
    const page = result.manifest.pages[0];
    expect(page).toMatchObject({
      id: "now-playing",
      name: "Now Playing",
      nodeId: "1:2",
      frame: { width: 360, height: 720 },
      image: { uri: "now-playing.png", scale: 2 },
    });
    expect(page?.placements[0]).toMatchObject({
      code: "ui/Button.kt#PrimaryButton",
      link: "code-connect",
      bounds: { x: 20, y: 100, width: 200, height: 48 },
    });
    expect(result.images.get("now-playing")).toBeInstanceOf(Uint8Array);
    expect(fetcher.calls).toEqual(["fetch:1:2", "render:1:2@2"]);
  });

  it("keeps the config's page order — that is the repo's stated priority", async () => {
    const fetcher = fakeFetcher({
      "1:2": pageDoc("Home", []),
      "1:3": pageDoc("Settings", []),
    });
    const result = await importPages({
      config: config({ pages: [{ nodeId: "1:3" }, { nodeId: "1:2" }] }),
      fetcher,
    });
    expect(result.manifest.pages.map((p) => p.name)).toEqual(["Settings", "Home"]);
  });

  it("honours an explicit page id and de-duplicates colliding slugs", async () => {
    const fetcher = fakeFetcher({
      "1:2": pageDoc("Settings", []),
      "1:3": pageDoc("Settings", []),
      "1:4": pageDoc("Settings", []),
    });
    const result = await importPages({
      config: config({
        pages: [{ nodeId: "1:2", id: "account-settings" }, { nodeId: "1:3" }, { nodeId: "1:4" }],
      }),
      fetcher,
    });
    expect(result.manifest.pages.map((p) => p.id)).toEqual([
      "account-settings",
      "settings",
      "settings-2",
    ]);
    expect(result.manifest.pages.map((p) => p.image.uri)).toEqual([
      "account-settings.png",
      "settings.png",
      "settings-2.png",
    ]);
  });

  it("passes the nesting setting through to the walk", async () => {
    const nestedTree = pageDoc("Home", [
      {
        id: "2:1",
        name: "OfferCard",
        type: "INSTANCE",
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 120 },
        children: [button("2:2", 10)],
      },
    ]);
    const flat = await importPages({ config: config(), fetcher: fakeFetcher({ "1:2": nestedTree }) });
    expect(flat.manifest.pages[0]?.placements).toHaveLength(1);

    const deep = await importPages({
      config: config({ nested: true }),
      fetcher: fakeFetcher({ "1:2": nestedTree }),
    });
    expect(deep.manifest.pages[0]?.placements).toHaveLength(2);
  });

  it("surfaces link warnings without failing the import", async () => {
    const result = await importPages({
      config: config(),
      fetcher: fakeFetcher({ "1:2": pageDoc("Home", [button("2:1", 0)]) }),
      inputs: { codeHandles: ["a/One.kt#Button", "b/Two.kt#Button"] },
    });
    expect(result.warnings.join("\n")).toMatch(/matches 2 code handles/);
    expect(result.manifest.pages[0]?.placements[0]?.link).toBe("unlinked");
  });

  it("is deterministic — the same inputs give byte-identical JSON", async () => {
    const run = async () =>
      JSON.stringify(
        (await importPages({
          config: config(),
          fetcher: fakeFetcher({ "1:2": pageDoc("Home", [button("2:2", 40), button("2:1", 10)]) }),
        })).manifest,
      );
    expect(await run()).toBe(await run());
  });
});

describe("writeImport", () => {
  it("writes pages.json plus one PNG per page", async () => {
    const outDir = join(await mkdtemp(join(tmpdir(), "page-backdrop-out-")), "pages");
    const result = await importPages({
      config: config({ outDir }),
      fetcher: fakeFetcher({ "1:2": pageDoc("Home", [button("2:1", 0)]) }),
    });
    const { manifestPath, imagePaths } = await writeImport(result, outDir);

    expect(await readdir(outDir)).toEqual(expect.arrayContaining([MANIFEST_FILENAME, "home.png"]));
    expect(imagePaths).toHaveLength(1);

    const text = await readFile(manifestPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(parseManifest(JSON.parse(text)).pages[0]?.id).toBe("home");
  });
});

describe("parseManifest", () => {
  it("rejects anything that is not a supported manifest", () => {
    expect(() => parseManifest(null)).toThrow(/not a page-backdrop manifest/);
    expect(() => parseManifest({ pages: "no" })).toThrow(/not a page-backdrop manifest/);
    expect(() => parseManifest({ version: 99, pages: [] })).toThrow(/version 99/);
  });
});
