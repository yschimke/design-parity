import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type { AdapterContext, DesignReference } from "@design-parity/core";

import {
  BundleAdapter,
  createBundleAdapter,
  BundleNotFoundError,
  BundleManifestError,
  BundleImageNotFoundError,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const ctx: AdapterContext = { repoRoot, env: {} };
const fixturePng = resolve(
  repoRoot,
  "fixtures/bundle/offer-card/offer-card.light.png",
);

/** Build a throwaway bundle directory; returns its path. */
async function tempBundle(
  files: Record<string, string | Buffer>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-parity-bundle-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

describe("BundleAdapter.resolve (directory)", () => {
  it("round-trips the committed bundle to the golden DesignReference", async () => {
    const adapter = new BundleAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "fixtures/bundle/offer-card",
      ctx,
    );

    const golden = JSON.parse(
      await readFile(
        resolve(repoRoot, "fixtures/bundle/offer-card.reference.json"),
        "utf8",
      ),
    ) as DesignReference;

    expect(ref).toEqual(golden);
    expect(ref.source).toBe("bundle");
    // The only link method possible for a source with no machine link.
    expect(ref.linkMethod).toBe("manifest");
    expect(ref.componentId).toBe("ui/Card.kt#OfferCard");
  });

  it("derives image dimensions from the PNG bytes, not the manifest", async () => {
    const adapter = createBundleAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "fixtures/bundle/offer-card",
      ctx,
    );
    expect(ref.referenceImages[0]).toMatchObject({ width: 240, height: 160 });
    expect(ref.referenceImages[1]).toMatchObject({ width: 240, height: 160 });
  });

  it("canonicalizes the bundle's size label via normalizeSize", async () => {
    // The manifest declares size '600px'; it must normalize to 'medium' so it
    // pairs with the candidate.
    const adapter = new BundleAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "fixtures/bundle/offer-card",
      ctx,
    );
    expect(ref.referenceImages.map((i) => i.size)).toEqual([
      "medium",
      "medium",
    ]);
  });

  it("carries through the manifest tokens", async () => {
    const adapter = new BundleAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "fixtures/bundle/offer-card",
      ctx,
    );
    expect(ref.tokens?.spacing?.padding).toBe(16);
    expect(ref.tokens?.radius?.corner).toBe(12);
  });

  it("keeps an unknown size label rather than dropping it", async () => {
    const dir = await tempBundle({
      "manifest.json": JSON.stringify({
        images: [{ state: "default", size: "jumbo", path: "img.png" }],
      }),
      "img.png": await readFile(fixturePng),
    });
    const ref = await new BundleAdapter().resolve("a#b", dir, ctx);
    expect(ref.referenceImages[0]?.size).toBe("jumbo");
  });

  it("throws BundleNotFoundError when the bundle is missing", async () => {
    const adapter = new BundleAdapter();
    await expect(
      adapter.resolve("a#b", "fixtures/bundle/does-not-exist", ctx),
    ).rejects.toThrow(BundleNotFoundError);
    await expect(
      adapter.resolve("a#b", "fixtures/bundle/does-not-exist", ctx),
    ).rejects.toThrow(/cannot read bundle/);
  });

  it("throws BundleManifestError when manifest.json is absent", async () => {
    const dir = await tempBundle({ "img.png": await readFile(fixturePng) });
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      /manifest\.json' is not in the bundle/,
    );
  });

  it("throws BundleManifestError when the manifest is not valid JSON", async () => {
    const dir = await tempBundle({ "manifest.json": "{ not json }" });
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      BundleManifestError,
    );
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("throws BundleManifestError when images is missing or empty", async () => {
    const dir = await tempBundle({
      "manifest.json": JSON.stringify({ images: [] }),
    });
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      /non-empty array/,
    );
  });

  it("throws BundleImageNotFoundError when a declared image is absent", async () => {
    const dir = await tempBundle({
      "manifest.json": JSON.stringify({
        images: [{ state: "default", path: "missing.png" }],
      }),
    });
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      BundleImageNotFoundError,
    );
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      /references image 'missing.png'/,
    );
  });

  it("throws when the manifest componentId contradicts the resolver", async () => {
    const dir = await tempBundle({
      "manifest.json": JSON.stringify({
        componentId: "ui/Other.kt#Thing",
        images: [{ state: "default", path: "img.png" }],
      }),
      "img.png": await readFile(fixturePng),
    });
    await expect(
      new BundleAdapter().resolve("ui/Card.kt#OfferCard", dir, ctx),
    ).rejects.toThrow(/declares componentId 'ui\/Other.kt#Thing'/);
  });

  it("rejects a non-PNG declared image", async () => {
    const dir = await tempBundle({
      "manifest.json": JSON.stringify({
        images: [{ state: "default", path: "img.png" }],
      }),
      "img.png": "not a png",
    });
    await expect(new BundleAdapter().resolve("a#b", dir, ctx)).rejects.toThrow(
      /is not a PNG image/,
    );
  });
});

describe("BundleAdapter.resolve (.zip)", () => {
  it("round-trips an in-memory unzip to a pairable DesignReference", async () => {
    const adapter = new BundleAdapter();
    const ref = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "fixtures/bundle/offer-card.zip",
      ctx,
    );

    expect(ref.source).toBe("bundle");
    expect(ref.linkMethod).toBe("manifest");
    expect(ref.componentId).toBe("ui/Card.kt#OfferCard");
    expect(ref.referenceImages).toHaveLength(2);
    expect(ref.referenceImages[0]).toMatchObject({
      state: "default",
      theme: "light",
      size: "medium",
      width: 240,
      height: 160,
    });
    // A zip entry has no standalone repo file; the uri traces '<zip>!<path>'.
    expect(ref.referenceImages[0]?.uri).toBe(
      "fixtures/bundle/offer-card.zip!offer-card.light.png",
    );
    expect(ref.tokens?.spacing?.padding).toBe(16);
  });

  it("throws BundleNotFoundError for a missing .zip", async () => {
    await expect(
      new BundleAdapter().resolve("a#b", "fixtures/bundle/missing.zip", ctx),
    ).rejects.toThrow(BundleNotFoundError);
  });

  it("supports a bundle assembled at an absolute directory path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "design-parity-bundle-abs-"));
    await mkdir(join(dir, "imgs"), { recursive: true });
    await copyFile(fixturePng, join(dir, "imgs", "a.png"));
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        images: [{ state: "default", path: "imgs/a.png" }],
      }),
    );
    const ref = await new BundleAdapter().resolve("a#b", dir, ctx);
    expect(ref.referenceImages[0]).toMatchObject({ width: 240, height: 160 });
    expect(ref.referenceImages[0]?.uri.endsWith("/imgs/a.png")).toBe(true);
  });
});
