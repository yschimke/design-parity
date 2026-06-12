import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFile, access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { AdapterContext, DesignReference } from "@design-parity/core";

import { createStitchAdapter } from "../src/adapter.js";
import {
  StitchAuthError,
  StitchManifestError,
  StitchSdkError,
} from "../src/errors.js";
import {
  createSdkStitchClient,
  type StitchClient,
  type StitchDesign,
} from "../src/stitch-client.js";
import type { Rasterizer } from "../src/rasterizer.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

// The Tailwind-classed markup Stitch returns for the offer card. Its utility
// classes encode exactly the golden fixture's tokens.
const OFFER_CARD_HTML = `
  <div class="flex flex-col gap-2 p-4 rounded-xl bg-[#F5F5F7]">
    <h3 class="font-[Inter] text-base font-semibold leading-6 text-[#1A1A1A]">Summer Sale</h3>
    <p class="font-[Inter] text-[13px] font-normal leading-[18px] text-[#5F6368]">Up to 50% off selected items.</p>
  </div>
`;

const design: StitchDesign = {
  screens: [
    { state: "default", theme: "light", size: "medium", html: OFFER_CARD_HTML },
  ],
};

/** A client that returns the offer-card design with no network. */
const fakeClient: StitchClient = {
  fetchDesign: async () => design,
};

let cardPng: Uint8Array;

beforeAll(async () => {
  cardPng = new Uint8Array(
    await readFile(resolve(repoRoot, "fixtures/stitch/offer-card.light.png")),
  );
});

/** A rasterizer that returns the committed reference PNG (240x160). */
const fakeRasterizer: Rasterizer = {
  rasterize: async () => cardPng,
};

function ctx(env: Record<string, string | undefined> = {}): AdapterContext {
  return { repoRoot, env };
}

describe("StitchAdapter.resolve (round-trip)", () => {
  let result: DesignReference;
  let golden: DesignReference;

  beforeAll(async () => {
    const outDir = await mkdtemp(join(tmpdir(), "stitch-out-"));
    const adapter = createStitchAdapter({
      client: fakeClient,
      rasterizer: fakeRasterizer,
      outDir,
    });
    result = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "stitch:design/abc123",
      ctx(),
    );
    golden = JSON.parse(
      await readFile(
        resolve(repoRoot, "fixtures/stitch/offer-card.reference.json"),
        "utf8",
      ),
    ) as DesignReference;
  });

  it("normalizes identity + manifest link method", () => {
    expect(result.componentId).toBe("ui/Card.kt#OfferCard");
    expect(result.source).toBe("stitch");
    expect(result.linkMethod).toBe("manifest");
    expect(result.ref).toBe("stitch:design/abc123");
  });

  it("extracts the golden fixture's Tailwind-derived tokens", () => {
    expect(result.tokens).toEqual(golden.tokens);
  });

  it("rasterizes the golden image variant with real PNG dimensions", async () => {
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
    for (const img of result.referenceImages) {
      await expect(access(img.uri)).resolves.toBeUndefined();
    }
  });

  it("round-trips to the golden reference (modulo the written image path)", () => {
    const strip = (ref: DesignReference): DesignReference => ({
      ...ref,
      referenceImages: ref.referenceImages.map(({ uri: _uri, ...rest }) => ({
        ...rest,
        uri: "",
      })),
    });
    expect(strip(result)).toEqual(strip(golden));
  });
});

describe("StitchAdapter.resolve (manifest correspondence)", () => {
  const designMapPath = resolve(repoRoot, "fixtures/design-map.json");

  it("resolves a code handle to its Stitch ref via design-map.json", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "stitch-out-"));
    const adapter = createStitchAdapter({
      client: fakeClient,
      rasterizer: fakeRasterizer,
      designMapPath,
      outDir,
    });
    // ref is the code handle, not a stitch: handle — forces a manifest lookup.
    const result = await adapter.resolve(
      "ui/Card.kt#OfferCard",
      "ui/Card.kt#OfferCard",
      ctx(),
    );
    expect(result.ref).toBe("stitch:design/abc123");
  });

  it("raises StitchManifestError when the component is absent from the map", async () => {
    const adapter = createStitchAdapter({
      client: fakeClient,
      rasterizer: fakeRasterizer,
      designMapPath,
    });
    await expect(
      adapter.resolve("ui/Unknown.kt#Nope", "ui/Unknown.kt#Nope", ctx()),
    ).rejects.toMatchObject({ code: "manifest-miss" });
    await expect(
      adapter.resolve("ui/Unknown.kt#Nope", "ui/Unknown.kt#Nope", ctx()),
    ).rejects.toBeInstanceOf(StitchManifestError);
  });

  it("raises StitchManifestError when the component maps to another source", async () => {
    const adapter = createStitchAdapter({
      client: fakeClient,
      rasterizer: fakeRasterizer,
      designMapPath,
    });
    // PrimaryButton maps to figma in the fixture map.
    await expect(
      adapter.resolve(
        "ui/Button.kt#PrimaryButton",
        "ui/Button.kt#PrimaryButton",
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "manifest-miss" });
  });
});

describe("StitchAdapter.resolve (SDK auth + availability)", () => {
  it("raises StitchAuthError when no credential is configured", async () => {
    // No client injected → the default SDK client is built from ctx.env.
    const adapter = createStitchAdapter({ rasterizer: fakeRasterizer });
    await expect(
      adapter.resolve("c#C", "stitch:proj/screen", ctx({})),
    ).rejects.toBeInstanceOf(StitchAuthError);
  });

  it("raises StitchSdkError when @google/stitch-sdk isn't installed", async () => {
    // A credential is present, so we get past auth and hit the dynamic import.
    const client = createSdkStitchClient({ STITCH_API_KEY: "key" });
    await expect(
      client.fetchDesign({ projectId: "proj", screenId: "screen" }),
    ).rejects.toBeInstanceOf(StitchSdkError);
  });
});
