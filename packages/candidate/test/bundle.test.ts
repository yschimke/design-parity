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
  rawPreviewIdForEntry,
  mergeCandidateRenders,
  catalogTokensFromBundle,
  themeTokenSetsFromBundle,
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
      (p) => (p.id === "ui.Button.Primary Button" ? "ui/Button.kt#PrimaryButton" : undefined),
    );
    expect(keyed!.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(keyed!.previewId).toBe("ui.Button.Primary Button");

    // Resolver declines (undefined): componentId falls back to the preview id,
    // but previewId is still set (a resolver ran).
    const [declined] = bundleToCandidates(
      await readPreviewBundle(bundlePath),
      () => undefined,
    );
    expect(declined!.componentId).toBe("ui.Button.PrimaryButton");
    expect(declined!.previewId).toBe("ui.Button.Primary Button");
  });

  it("uses rawPreviewIds for correspondence while reading sanitized asset paths", async () => {
    const png = new Uint8Array(
      await readFile(resolve(repoRoot, "fixtures/figma/button-primary.light.png")),
    );
    const sanitized = "app.ChatKt.ContactChatPreview_Contact_chat";
    const raw = "app.ChatKt.ContactChatPreview_Contact chat";
    const bundle: PreviewBundle = {
      manifest: {
        previewIds: [sanitized],
        rawPreviewIds: [raw],
      },
      previews: [{ id: sanitized }],
      entries: { [`previews/${sanitized}.png`]: png },
    };

    expect(rawPreviewIdForEntry(bundle, bundle.previews[0]!)).toBe(raw);
    const candidate = previewToCandidate(bundle, bundle.previews[0]!, (preview) =>
      preview.id === raw ? "ui/Chat.kt#ContactChat" : undefined,
    );
    expect(candidate.componentId).toBe("ui/Chat.kt#ContactChat");
    expect(candidate.previewId).toBe(raw);
    expect(candidate.images[0]?.uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("falls back to the entry id for absent or misaligned rawPreviewIds", async () => {
    const bundle = await readPreviewBundle(bundlePath);
    const entry = bundle.previews[0]!;
    const manifest = bundle.manifest;
    bundle.manifest = {};
    expect(rawPreviewIdForEntry(bundle, entry)).toBe(entry.id);

    bundle.manifest = { ...manifest, rawPreviewIds: [""] };
    expect(rawPreviewIdForEntry(bundle, entry)).toBe(entry.id);
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

describe("catalogTokensFromBundle", () => {
  const te = new TextEncoder();
  const sidecar = (previewId: string, tokens: unknown[]): Uint8Array =>
    te.encode(JSON.stringify({ schema: "compose-preview-catalog-tokens/v1", previewId, tokens }));
  const themeSidecar = (previewId: string, theme: string, tokens: unknown[]): Uint8Array =>
    te.encode(
      JSON.stringify({ schema: "compose-preview-catalog-tokens/v1", previewId, theme, tokens }),
    );

  it("aggregates @ColorCatalog and @TypographyCatalog sidecars into system tokens", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/colorcatalog__Brand.catalog.json": sidecar("colorcatalog__Brand", [
          { label: "BrandCoral", kind: "COLOR", color: { hex: "#FFFF6F61", argb: -37023 } },
          { label: "Scrim", kind: "COLOR", color: { hex: "#80000000", argb: -2147483648 } },
        ]),
        "previews/typographycatalog__Display.catalog.json": sidecar(
          "typographycatalog__Display",
          [
            {
              label: "DisplayLarge",
              kind: "TEXT_STYLE",
              textStyle: { fontSizeSp: 45, fontWeight: 400 },
            },
            {
              label: "Body Large",
              kind: "TEXT_STYLE",
              textStyle: { fontSizeSp: 16, fontWeight: 500, fontStyle: "italic", lineHeightSp: 24 },
            },
          ],
        ),
      },
    };

    const tokens = catalogTokensFromBundle(bundle);
    // Colours: keyed by token name, ARGB hex reformatted to CSS `#rrggbbaa`.
    expect(tokens?.colors).toEqual({
      BrandCoral: "#ff6f61ff",
      Scrim: "#00000080",
    });
    // Type styles: sp magnitudes carried straight onto TypographyToken.
    expect(tokens?.typography?.DisplayLarge).toEqual({ fontSize: 45, fontWeight: 400 });
    expect(tokens?.typography?.["Body Large"]).toEqual({
      fontSize: 16,
      fontWeight: 500,
      fontStyle: "italic",
      lineHeight: 24,
    });
  });

  it("leaves a declared theme's palette out of the SYSTEM token set", () => {
    // A theme sheet's sidecar is tagged with its theme; the system set is the
    // untagged sheets only. Before that split every theme was merged in here, and
    // since M3 role labels repeat across themes the surviving value was decided by
    // zip iteration order — a system's published `primary` was whichever theme
    // happened to be read last.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/colorcatalog__Palette.catalog.json": sidecar("colorcatalog__Palette", [
          { label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } },
        ]),
        "previews/wearthemecatalog__Coral.catalog.json": themeSidecar(
          "wearthemecatalog__Coral",
          "Coral",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FFFF6F61" } }],
        ),
        "previews/wearthemecatalog__Teal.catalog.json": themeSidecar(
          "wearthemecatalog__Teal",
          "Teal",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FF00BFA5" } }],
        ),
      },
    };
    expect(catalogTokensFromBundle(bundle)?.colors).toEqual({ primary: "#aecbfaff" });
  });

  it("returns undefined for a bundle with no catalog sidecars", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: { "previews/a.b.CKt.Foo.png": Uint8Array.of(1, 2, 3) },
    };
    expect(catalogTokensFromBundle(bundle)).toBeUndefined();
  });

  it("skips a malformed sidecar without throwing", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/bad.catalog.json": te.encode("{ not json"),
        "previews/colorcatalog__Brand.catalog.json": sidecar("colorcatalog__Brand", [
          { label: "BrandCoral", kind: "COLOR", color: { hex: "#FFFF6F61" } },
        ]),
      },
    };
    expect(catalogTokensFromBundle(bundle)?.colors).toEqual({ BrandCoral: "#ff6f61ff" });
  });
});

describe("themeTokenSetsFromBundle", () => {
  const te = new TextEncoder();
  const themeSidecar = (previewId: string, theme: string, tokens: unknown[]): Uint8Array =>
    te.encode(
      JSON.stringify({ schema: "compose-preview-catalog-tokens/v1", previewId, theme, tokens }),
    );

  it("returns one token set per declared theme, colours and typeface alike", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        // Untagged: the system's own sheet, which is NOT a theme.
        "previews/colorcatalog__Palette.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            previewId: "colorcatalog__Palette",
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
          }),
        ),
        "previews/wearthemecatalog__KotlinConf.catalog.json": themeSidecar(
          "wearthemecatalog__KotlinConf",
          "KotlinConf",
          [
            { label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } },
            {
              label: "titleMedium",
              kind: "TEXT_STYLE",
              textStyle: { fontFamily: "JetBrains Mono", fontSizeSp: 16, fontWeight: 500 },
            },
          ],
        ),
        "previews/wearthemecatalog__Coral.catalog.json": themeSidecar(
          "wearthemecatalog__Coral",
          "Coral",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FFFF6F61" } }],
        ),
      },
    };

    const themes = themeTokenSetsFromBundle(bundle);
    // Ordered by preview id, so a regenerated bundle produces a stable list.
    expect(themes.map((t) => t.theme)).toEqual(["Coral", "KotlinConf"]);
    expect(themes[0]?.tokens.colors).toEqual({ primary: "#ff6f61ff" });
    // The typeface travels too — a theme is free to swap the type scale, and that
    // is half of what distinguishes one theme sheet from another.
    expect(themes[1]?.tokens.typography?.titleMedium).toEqual({
      fontFamily: "JetBrains Mono",
      fontSize: 16,
      fontWeight: 500,
    });
    // The previewId is the join key back to previews.json, where the entry's
    // wrapperClassName gives the provider FQN a preview server addresses.
    expect(themes[1]?.previewId).toBe("wearthemecatalog__KotlinConf");
  });

  it("treats a blank theme label as a theme, not as system tokens", () => {
    // The tag's PRESENCE is the discriminator. A provider that declared no display
    // name writes `theme: ""`; reading that as a system sheet would be the worst of
    // both worlds — its repeated M3 roles overwriting the system's own tokens while
    // the theme vanished from the list.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/colorcatalog__Palette.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            previewId: "colorcatalog__Palette",
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
          }),
        ),
        "previews/themecatalog__Unnamed.catalog.json": themeSidecar(
          "themecatalog__Unnamed",
          "",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } }],
        ),
      },
    };
    expect(catalogTokensFromBundle(bundle)?.colors).toEqual({ primary: "#aecbfaff" });
    const themes = themeTokenSetsFromBundle(bundle);
    expect(themes).toHaveLength(1);
    expect(themes[0]?.theme).toBe("");
    expect(themes[0]?.tokens.colors).toEqual({ primary: "#7f52ffff" });
  });

  it("falls back to the sidecar's own path for a missing preview id", () => {
    // The join key is what makes the tokens publishable — without it a consumer
    // cannot reach `previews.json` for the provider FQN. The file name carries it.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Brand.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            theme: "Brand",
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } }],
          }),
        ),
      },
    };
    expect(themeTokenSetsFromBundle(bundle)[0]?.previewId).toBe("themecatalog__Brand");
  });

  it("drops a text style whose metrics all failed to reflect", () => {
    // `textStyle: {}` resolves to an empty token. Keeping it would serialise
    // downstream as a DTCG `$value: {}` AND make a theme that resolved nothing
    // usable look like it did.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Hollow.catalog.json": themeSidecar(
          "themecatalog__Hollow",
          "Hollow",
          [{ label: "titleMedium", kind: "TEXT_STYLE", textStyle: {} }],
        ),
        "previews/themecatalog__Real.catalog.json": themeSidecar(
          "themecatalog__Real",
          "Real",
          [
            { label: "titleMedium", kind: "TEXT_STYLE", textStyle: {} },
            { label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } },
          ],
        ),
      },
    };
    const themes = themeTokenSetsFromBundle(bundle);
    // The all-empty sheet is gone; the real one kept its colour and grew no
    // hollow typography group.
    expect(themes.map((t) => t.theme)).toEqual(["Real"]);
    expect(themes[0]?.tokens.typography).toBeUndefined();
    expect(themes[0]?.tokens.colors).toEqual({ primary: "#7f52ffff" });
  });

  it("skips a structurally malformed sidecar instead of aborting the bundle", () => {
    // Parseable JSON is not the same as a sidecar. Each of these got past
    // `JSON.parse` and would then throw when read — taking every other theme in
    // the bundle down with it.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/notobject.catalog.json": te.encode("null"),
        "previews/anarray.catalog.json": te.encode("[]"),
        "previews/tokensnotarray.catalog.json": te.encode(
          JSON.stringify({ theme: "Brand", tokens: {} }),
        ),
        "previews/themecatalog__Good.catalog.json": themeSidecar(
          "themecatalog__Good",
          "Good",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } }],
        ),
      },
    };
    expect(themeTokenSetsFromBundle(bundle).map((t) => t.theme)).toEqual(["Good"]);
    expect(() => catalogTokensFromBundle(bundle)).not.toThrow();
  });

  it("resolves each theme's provider FQN from the bundle's preview list", () => {
    // The FQN is the theme's identity — what a preview server addresses it by and
    // what `CatalogTheme.id` wants — so the join happens here rather than being
    // left to every consumer (which could not do it: it lives on the preview
    // entry's params, not on the sidecar).
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [
        {
          id: "wearthemecatalog__Google Sans Flex",
          params: { wrapperClassName: "com.example.WearGoogleSansFlexThemeCatalog" },
        },
        { id: "wearthemecatalog__Coral", params: { wrapperClassName: "com.example.WearCoral" } },
        { id: "unrelated", params: {} },
      ],
      entries: {
        // The file name is the renderer's SANITIZED id (spaces folded), while the
        // payload carries none — so this only joins if the fallback matches the
        // way the renderer spells it.
        "previews/wearthemecatalog__Google_Sans_Flex.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            theme: "Google Sans Flex",
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
          }),
        ),
        "previews/wearthemecatalog__Coral.catalog.json": themeSidecar(
          "wearthemecatalog__Coral",
          "Coral",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FFFF6F61" } }],
        ),
      },
    };
    const byTheme = Object.fromEntries(
      themeTokenSetsFromBundle(bundle).map((t) => [t.theme, t.providerFqn]),
    );
    expect(byTheme).toEqual({
      Coral: "com.example.WearCoral",
      "Google Sans Flex": "com.example.WearGoogleSansFlexThemeCatalog",
    });
  });

  it("joins whichever spelling of the id each side happens to use", () => {
    // A preview has up to three spellings: the filename-safe id in `previews.json`,
    // the canonical one in the manifest's `rawPreviewIds`, and the file name of the
    // sidecar (safe again). Sanitizing one side only finds the pair in one
    // direction — here the payload keeps the RAW id while the entry carries the
    // safe one, which is the direction that used to miss.
    const bundle: PreviewBundle = {
      manifest: {
        previewIds: ["wearthemecatalog__Google_Sans_Flex"],
        rawPreviewIds: ["wearthemecatalog__Google Sans Flex"],
      },
      previews: [
        {
          id: "wearthemecatalog__Google_Sans_Flex",
          params: { wrapperClassName: "com.example.WearGoogleSansFlexThemeCatalog" },
        },
      ],
      entries: {
        "previews/wearthemecatalog__Google_Sans_Flex.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            previewId: "wearthemecatalog__Google Sans Flex",
            theme: "Google Sans Flex",
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
          }),
        ),
      },
    };
    expect(themeTokenSetsFromBundle(bundle)[0]?.providerFqn).toBe(
      "com.example.WearGoogleSansFlexThemeCatalog",
    );
  });

  it("leaves the FQN absent when the preview list doesn't carry the specimen", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Brand.catalog.json": themeSidecar(
          "themecatalog__Brand",
          "Brand",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } }],
        ),
      },
    };
    const theme = themeTokenSetsFromBundle(bundle)[0];
    expect(theme?.providerFqn).toBeUndefined();
    expect(theme?.previewId).toBe("themecatalog__Brand");
  });

  it("survives a preview id that isn't a string", () => {
    // The payload is JSON: `previewId` can be anything. Calling `.trim()` on a
    // number took the whole bundle's themes down with it.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Numeric.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            theme: "Numeric",
            previewId: 123,
            tokens: [{ label: "primary", kind: "COLOR", color: { hex: "#FF7F52FF" } }],
          }),
        ),
        "previews/themecatalog__Good.catalog.json": themeSidecar(
          "themecatalog__Good",
          "Good",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
        ),
      },
    };
    const themes = themeTokenSetsFromBundle(bundle);
    expect(themes.map((t) => t.theme).sort()).toEqual(["Good", "Numeric"]);
    // …and the bad id falls back to the one its own file name carries.
    expect(themes.find((t) => t.theme === "Numeric")?.previewId).toBe(
      "themecatalog__Numeric",
    );
  });

  it("skips mistyped nested fields instead of aborting the bundle", () => {
    // The interface describes a WELL-FORMED sidecar; the value came from
    // `JSON.parse`, so any field can be anything. A number where a hex string
    // belongs used to throw inside `argbToCssHex` and take every theme with it.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Mistyped.catalog.json": te.encode(
          JSON.stringify({
            schema: "compose-preview-catalog-tokens/v1",
            theme: "Mistyped",
            tokens: [
              { label: "primary", kind: "COLOR", color: { hex: 123 } },
              { label: 42, kind: "COLOR", color: { hex: "#FF7F52FF" } },
              {
                label: "titleMedium",
                kind: "TEXT_STYLE",
                textStyle: { fontFamily: "Inter", fontSizeSp: "16sp", fontWeight: 500 },
              },
            ],
          }),
        ),
        "previews/themecatalog__Good.catalog.json": themeSidecar(
          "themecatalog__Good",
          "Good",
          [{ label: "primary", kind: "COLOR", color: { hex: "#FFAECBFA" } }],
        ),
      },
    };
    const themes = themeTokenSetsFromBundle(bundle);
    expect(themes.map((t) => t.theme).sort()).toEqual(["Good", "Mistyped"]);
    const mistyped = themes.find((t) => t.theme === "Mistyped");
    // The unusable colour and the non-string label are dropped; the good half of
    // the text style survives, minus the size that came through as a string.
    expect(mistyped?.tokens.colors).toBeUndefined();
    expect(mistyped?.tokens.typography?.titleMedium).toEqual({
      fontFamily: "Inter",
      fontWeight: 500,
    });
  });

  it("orders themes by code unit, not by the runtime's locale", () => {
    // This list feeds generated artifacts. `localeCompare` would order non-ASCII
    // ids by whatever ICU locale the consumer's CI runs under — `ä` before `z` in
    // English, after it in Swedish — so the same bundle could produce two orders.
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/zulu.catalog.json": themeSidecar("zulu", "Zulu", [
          { label: "primary", kind: "COLOR", color: { hex: "#FF000001" } },
        ]),
        "previews/ätherisch.catalog.json": themeSidecar("ätherisch", "Ätherisch", [
          { label: "primary", kind: "COLOR", color: { hex: "#FF000002" } },
        ]),
      },
    };
    expect(themeTokenSetsFromBundle(bundle).map((t) => t.previewId)).toEqual([
      "zulu",
      "ätherisch",
    ]);
  });

  it("is empty for a system that declares no themes", () => {
    expect(
      themeTokenSetsFromBundle({ manifest: {}, previews: [], entries: {} }),
    ).toEqual([]);
  });

  it("drops a theme sheet that resolved no usable token", () => {
    const bundle: PreviewBundle = {
      manifest: {},
      previews: [],
      entries: {
        "previews/themecatalog__Empty.catalog.json": themeSidecar(
          "themecatalog__Empty",
          "Empty",
          [{ kind: "COLOR", color: { hex: "#FF000000" } }],
        ),
        "previews/bad.catalog.json": te.encode("{ not json"),
      },
    };
    expect(themeTokenSetsFromBundle(bundle)).toEqual([]);
  });
});

