import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type {
  AdapterContext,
  CandidateRender,
  DesignReference,
} from "@design-parity/core";
import { diff } from "@design-parity/diff";

import {
  readPreviewBundle,
  parsePreviewBundle,
  bundleToCandidates,
  loadPreviewBundle,
  previewToCandidate,
  mergeCandidateRenders,
  bundleCandidateSource,
  cliRenderSource,
  localComposeWebSource,
  firstAvailable,
  InvalidBundleError,
  NotImplementedError,
  type CandidateSource,
  type PreviewBundle,
  type PreviewEntry,
} from "../src/index.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const bundlePath = here("fixtures/preview-bundle.png");
const ctx: AdapterContext = { repoRoot, env: {} };

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

describe("readPreviewBundle", () => {
  it("round-trips a polyglot bundle to the golden CandidateRender", async () => {
    const candidates = await loadPreviewBundle(bundlePath);
    expect(candidates).toHaveLength(1);
    const golden = await readJson<CandidateRender>(
      here("fixtures/expected-candidate.json"),
    );
    expect(candidates[0]).toEqual(golden);
  });

  it("emits data: PNG URIs with dims read from the IHDR", async () => {
    const [candidate] = await loadPreviewBundle(bundlePath);
    for (const image of candidate!.images) {
      expect(image.uri.startsWith("data:image/png;base64,")).toBe(true);
      expect(image.width).toBe(160);
      expect(image.height).toBe(48);
    }
  });

  it("maps id → componentId, uiMode → theme, widthDp → canonical size", async () => {
    const [candidate] = await loadPreviewBundle(bundlePath);
    expect(candidate!.componentId).toBe("ui.Button.PrimaryButton");
    expect(candidate!.images.map((i) => i.theme)).toEqual(["light", "dark"]);
    expect(candidate!.images.map((i) => i.size)).toEqual(["compact", "compact"]);
  });

  it("populates a SemanticTree from the bundle's semantics blob", async () => {
    const [candidate] = await loadPreviewBundle(bundlePath);
    const root = candidate!.semantics.root;
    expect(candidate!.semantics.theme).toBe("light");
    expect(root.role).toBe("button");
    expect(root.label).toBe("Continue");
    expect(root.tokens?.colors?.["container.light"]).toBe("#645AFF");
    expect(root.children?.[0]?.role).toBe("text");
  });

  it("accepts raw bytes as well as a path", async () => {
    const bytes = new Uint8Array(await readFile(bundlePath));
    const fromBytes = bundleToCandidates(parsePreviewBundle(bytes));
    const fromPath = bundleToCandidates(await readPreviewBundle(bundlePath));
    expect(fromBytes).toEqual(fromPath);
  });

  it("re-keys componentId via the resolver callback, preserving previewId (#44)", async () => {
    // Default (no resolver): componentId stays the raw preview id, no previewId.
    const [plain] = bundleToCandidates(await readPreviewBundle(bundlePath));
    expect(plain!.componentId).toBe("ui.Button.PrimaryButton");
    expect(plain!.previewId).toBeUndefined();

    // With a resolver: componentId becomes the code handle; previewId retained.
    const [keyed] = bundleToCandidates(
      await readPreviewBundle(bundlePath),
      (p) => (p.id === "ui.Button.PrimaryButton" ? "ui/Button.kt#PrimaryButton" : undefined),
    );
    expect(keyed!.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(keyed!.previewId).toBe("ui.Button.PrimaryButton");

    // Resolver declines (undefined): componentId falls back to the preview id,
    // but previewId is still set (a resolver ran).
    const [declined] = bundleToCandidates(
      await readPreviewBundle(bundlePath),
      () => undefined,
    );
    expect(declined!.componentId).toBe("ui.Button.PrimaryButton");
    expect(declined!.previewId).toBe("ui.Button.PrimaryButton");
  });

  it("assigns image theme from a name convention and an explicit hint (#48)", async () => {
    // A real PNG so readPngSize can read the IHDR; the bytes are theme-agnostic.
    const png = new Uint8Array(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.light.png")),
    );
    const bundleFor = (entry: PreviewEntry): PreviewBundle => ({
      manifest: {},
      previews: [entry],
      entries: { [`previews/${entry.id}.png`]: png },
    });

    // uiMode unset (CompositionLocal theming) + a `_Dark` suffix → dark.
    const dark = previewToCandidate(
      bundleFor({ id: "ee.app.Tile_LightOn_Dark" }),
      { id: "ee.app.Tile_LightOn_Dark" },
    );
    expect(dark.images[0]?.theme).toBe("dark");

    // The sibling without the suffix gets no (mis-read) theme from "LightOn".
    const plain = previewToCandidate(bundleFor({ id: "ee.app.Tile_LightOn" }), {
      id: "ee.app.Tile_LightOn",
    });
    expect(plain.images[0]?.theme).toBeUndefined();

    // An explicit per-preview hint wins.
    const hinted = previewToCandidate(
      bundleFor({ id: "ee.app.Tile_LightOn", params: { theme: "dark" } }),
      { id: "ee.app.Tile_LightOn", params: { theme: "dark" } },
    );
    expect(hinted.images[0]?.theme).toBe("dark");
  });

  it("re-tags a preview's images onto a resolved variant slot (#111)", async () => {
    const png = new Uint8Array(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.light.png")),
    );
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [{ id: "app.DeviceKt.DeviceBodyDarkPreview" }],
      entries: {
        "previews/app.DeviceKt.DeviceBodyDarkPreview.png": png,
      },
    };
    // The design-map link tags this per-theme preview as the dark variant; the
    // candidate's image picks up that theme even though the params didn't imply it.
    const candidate = previewToCandidate(bundle, bundle.previews[0]!, (p) =>
      p.id === "app.DeviceKt.DeviceBodyDarkPreview"
        ? { code: "ui/Device.kt#DeviceBody", variant: { theme: "dark" } }
        : undefined,
    );
    expect(candidate.componentId).toBe("ui/Device.kt#DeviceBody");
    expect(candidate.images[0]?.theme).toBe("dark");
  });

  it("fails clearly on bytes with no embedded bundle", () => {
    // A bare PNG signature with no appended zip is not a bundle.
    const notABundle = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8);
    expect(() => parsePreviewBundle(notABundle)).toThrow(InvalidBundleError);
  });
});

describe("mergeCandidateRenders (#111)", () => {
  it("concatenates images and prefers a light-themed semantics tree", () => {
    const dark = {
      componentId: "ui/Device.kt#DeviceBody",
      previewId: "app.DeviceKt.DeviceBodyDarkPreview",
      images: [{ state: "default", theme: "dark" as const, uri: "d", width: 1, height: 1 }],
      semantics: { root: { role: "screen" }, theme: "dark" as const },
    };
    const light = {
      componentId: "ui/Device.kt#DeviceBody",
      previewId: "app.DeviceKt.DeviceBodyPreview",
      images: [{ state: "default", theme: "light" as const, uri: "l", width: 1, height: 1 }],
      semantics: { root: { role: "screen" }, theme: "light" as const },
    };
    const merged = mergeCandidateRenders(dark, light);
    expect(merged.componentId).toBe("ui/Device.kt#DeviceBody");
    expect(merged.images.map((i) => i.theme)).toEqual(["dark", "light"]);
    // The diff keys tokens off one tree; prefer the light one regardless of order.
    expect(merged.semantics.theme).toBe("light");
    // previewId keeps the first render's, still reconcilable to a source preview.
    expect(merged.previewId).toBe("app.DeviceKt.DeviceBodyDarkPreview");
  });
});

describe("bundleCandidateSource merges per-theme previews (#111)", () => {
  it("binds two previews to one code handle as a light+dark candidate", async () => {
    const png = new Uint8Array(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.light.png")),
    );
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [
        { id: "app.DeviceKt.DeviceBodyPreview" },
        { id: "app.DeviceKt.DeviceBodyDarkPreview" },
      ],
      entries: {
        "previews/app.DeviceKt.DeviceBodyPreview.png": png,
        "previews/app.DeviceKt.DeviceBodyDarkPreview.png": png,
      },
    };
    const source = bundleCandidateSource({
      bundles: [bundle],
      resolveComponentId: (p) =>
        p.id === "app.DeviceKt.DeviceBodyPreview"
          ? { code: "ui/Device.kt#DeviceBody", variant: { theme: "light" } }
          : p.id === "app.DeviceKt.DeviceBodyDarkPreview"
            ? { code: "ui/Device.kt#DeviceBody", variant: { theme: "dark" } }
            : undefined,
    });
    const candidate = await source.getCandidate("ui/Device.kt#DeviceBody", ctx);
    expect(candidate?.componentId).toBe("ui/Device.kt#DeviceBody");
    // One merged render carrying both themed images → the report matrix's two columns.
    expect(candidate?.images.map((i) => i.theme).sort()).toEqual(["dark", "light"]);
  });
});

describe("feeding a bundle candidate through diff()", () => {
  it("runs the parity diff and surfaces a11y/i18n findings via the semantics", async () => {
    const [candidate] = await loadPreviewBundle(bundlePath);
    // Reference is intentionally mismatched (the committed Figma fixture) so the
    // diff has deterministic findings; we only assert the engine runs and that
    // the candidate's semantics flow through to the spec-backed checks.
    const reference = await readJson<DesignReference>(
      resolve(repoRoot, "fixtures/figma/button-primary.reference.json"),
    );
    const { verdict } = await diff(reference, candidate!, { repoRoot });
    expect(["pass", "warn", "fail"]).toContain(verdict.status);
    const kinds = new Set(verdict.findings.map((f) => f.kind));
    // Visual diff ran (image pairing off the data: URIs).
    expect(verdict.visualScores).toBeDefined();
    expect(kinds.has("visual")).toBe(true);
    // The semantics blob carried real role/label/bounds + a fg/bg colour pair,
    // so the spec-backed a11y check (contrast is the headline finding) ran —
    // proving the semantics flowed through from the bundle to the checks.
    expect(kinds.has("contrast")).toBe(true);
  });
});

describe("bundleCandidateSource", () => {
  it("indexes previews by componentId and serves the CandidateRender", async () => {
    const source = bundleCandidateSource({ paths: [bundlePath] });
    expect(source.kind).toBe("bundle");
    const got = await source.getCandidate("ui.Button.PrimaryButton", ctx);
    expect(got?.componentId).toBe("ui.Button.PrimaryButton");
  });

  it("returns undefined for an unknown component", async () => {
    const source = bundleCandidateSource({ paths: [bundlePath] });
    expect(await source.getCandidate("ui.Other.Thing", ctx)).toBeUndefined();
  });

  it("rejects an empty configuration", () => {
    expect(() => bundleCandidateSource({})).toThrow(InvalidBundleError);
  });
});

describe("firstAvailable", () => {
  it("falls through to the next source on undefined", async () => {
    const empty: CandidateSource = {
      kind: "empty",
      async getCandidate() {
        return undefined;
      },
    };
    const bundle = bundleCandidateSource({ paths: [bundlePath] });
    const combined = firstAvailable([empty, bundle]);
    const got = await combined.getCandidate("ui.Button.PrimaryButton", ctx);
    expect(got?.componentId).toBe("ui.Button.PrimaryButton");
    expect(combined.kind).toContain("bundle");
  });

  it("returns undefined when no source has the component", async () => {
    const combined = firstAvailable([
      bundleCandidateSource({ paths: [bundlePath] }),
    ]);
    expect(await combined.getCandidate("nope", ctx)).toBeUndefined();
  });
});

describe("cliRenderSource", () => {
  it("declines a component when the mapper returns undefined", async () => {
    const source = cliRenderSource(() => undefined);
    expect(source.kind).toBe("cli");
    expect(await source.getCandidate("anything", ctx)).toBeUndefined();
  });
});

describe("stub sources", () => {
  it("localComposeWebSource throws a clear not-implemented error", async () => {
    const source = localComposeWebSource();
    expect(source.kind).toBe("local-compose-web");
    await expect(source.getCandidate("x", ctx)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

});
