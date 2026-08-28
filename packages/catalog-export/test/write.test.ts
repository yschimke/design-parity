import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeCatalog } from "../src/write.js";
import type { Catalog } from "../src/types.js";

// A 1x1 transparent PNG, base64 — bytes are opaque to the writer.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URI = `data:image/png;base64,${PNG_B64}`;

let out: string;
let src: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "catalog-out-"));
  src = await mkdtemp(join(tmpdir(), "catalog-src-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
  await rm(src, { recursive: true, force: true });
});

function catalogWith(idealUri: string, layoutUri: string): Catalog {
  return {
    meta: { system: "compose-m3", title: "Compose Material 3" },
    themeTokens: { colors: { "primary.light": "#fff", "primary.dark": "#000" }, radius: { sm: 8 } },
    components: [
      {
        componentId: "Button/Filled",
        variants: {
          ideal: [{ state: "default", theme: "light", uri: idealUri, width: 1, height: 1 }],
          layout: [{ state: "default", theme: "light", uri: layoutUri, width: 1, height: 1 }],
        },
        greenlines: [],
        redlines: [],
        wireframeSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      },
    ],
  };
}

describe("writeCatalog", () => {
  it("carries the source repo's committed known differences", async () => {
    // The publish half of the parity acceptance contract. Unconditional rather than opt-in: an
    // acceptance the repo committed and the bundle omits is one that silently stops suppressing,
    // which is the failure mode the whole contract is built to avoid.
    await mkdir(join(src, ".design-parity", "known-differences", "glyph"), { recursive: true });
    await writeFile(
      join(src, ".design-parity", "known-differences.json"),
      '{"schema":"compose-preview-known-differences/v1","acceptances":[]}',
    );
    await writeFile(join(src, ".design-parity", "known-differences", "glyph", "mask.png"), "mask");

    const result = await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out, {
      // The repository root, NOT `sourceRoot`: that one is where relative image URIs resolve — the
      // render output — and reusing it here type-checks, reads plausibly and publishes nothing,
      // because `<renders>/.design-parity/` never exists.
      knownDifferencesRoot: src,
    });

    expect(result.knownDifferences?.artifactCount).toBe(1);
    expect(await readFile(join(out, "parity", "known-differences.json"), "utf8")).toBe(
      '{"schema":"compose-preview-known-differences/v1","acceptances":[]}',
    );
    expect(
      await readFile(join(out, "parity", "known-differences", "glyph", "mask.png"), "utf8"),
    ).toBe("mask");
  });

  it("clears a previous publish when the copy is switched off", async () => {
    // Skipping the copy is not the same as skipping the cleanup. A caller that carried acceptances
    // once and then set `knownDifferences: false` on a reused output directory would otherwise
    // publish a bundle still containing them — suppressing differences after being explicitly
    // switched off, and only on the second render.
    await mkdir(join(src, ".design-parity", "known-differences", "glyph"), { recursive: true });
    await writeFile(
      join(src, ".design-parity", "known-differences.json"),
      '{"schema":"compose-preview-known-differences/v1","acceptances":[]}',
    );
    await writeFile(join(src, ".design-parity", "known-differences", "glyph", "mask.png"), "mask");
    await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out, {
      knownDifferencesRoot: src,
    });

    const second = await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out, {
      knownDifferencesRoot: src,
      knownDifferences: false,
    });
    expect(second.knownDifferences).toBeUndefined();
    await expect(readFile(join(out, "parity", "known-differences.json"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(out, "parity", "known-differences", "glyph", "mask.png"), "utf8"),
    ).rejects.toThrow();
  });

  it("writes no parity directory for a repo that has accepted nothing", async () => {
    const result = await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out, {
      knownDifferencesRoot: src,
    });
    expect(result.knownDifferences?.documentPath).toBeUndefined();
    await expect(readFile(join(out, "parity", "known-differences.json"), "utf8")).rejects.toThrow();
  });

  it("writes manifest, DTCG tokens, figma variables, and image bytes from data URIs", async () => {
    const result = await writeCatalog(catalogWith(PNG_DATA_URI, PNG_DATA_URI), out);

    expect(result.imageCount).toBe(2);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(manifest.schema).toBe("design-parity-catalog/v1");
    expect(manifest.tokensFile).toBe("tokens.dtcg.json");

    const dtcg = JSON.parse(await readFile(result.tokensPath!, "utf8"));
    expect(dtcg.color["primary.light"].$value).toBe("#fff");
    expect(dtcg.radius.sm.$value).toBe(8);

    const figma = JSON.parse(await readFile(result.figmaPath!, "utf8"));
    expect(Object.keys(figma.modes).sort()).toEqual(["dark", "light"]);

    const png = await readFile(join(out, "images/button-filled/ideal__default__light.png"));
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");

    // The pre-generated wireframe SVG is baked into the bundle + referenced.
    expect(result.wireframeCount).toBe(1);
    expect(manifest.components[0].wireframe).toBe("wireframes/button-filled.svg");
    const svg = await readFile(join(out, "wireframes/button-filled.svg"), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("resolves relative image paths against sourceRoot", async () => {
    await mkdir(join(src, "renders"), { recursive: true });
    await writeFile(join(src, "renders/i.png"), Buffer.from(PNG_B64, "base64"));
    await writeFile(join(src, "renders/w.png"), Buffer.from(PNG_B64, "base64"));

    const result = await writeCatalog(
      catalogWith("renders/i.png", "renders/w.png"),
      out,
      { sourceRoot: src },
    );
    expect(result.imageCount).toBe(2);
    const png = await readFile(join(out, "images/button-filled/layout__default__light.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("writes one DTCG file per alternate theme, at the paths the manifest names", async () => {
    const catalog = catalogWith(PNG_DATA_URI, PNG_DATA_URI);
    catalog.themes = [
      {
        id: "com.example.BrandDarkThemeCatalog",
        name: "Brand Dark",
        group: "Brand",
        dark: true,
        tokens: {
          colors: { primary: "#4dd0e1" },
          typography: { titleMedium: { fontFamily: "Rubik", fontSize: 16 } },
        },
      },
      {
        id: "com.example.HighContrastThemeCatalog",
        name: "High Contrast",
        tokens: { colors: { primary: "#000000" } },
      },
    ];

    const result = await writeCatalog(catalog, out);

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    // The SYSTEM token set is untouched — the themes are additive.
    expect(manifest.tokensFile).toBe("tokens.dtcg.json");
    expect(manifest.themes).toEqual([
      {
        id: "com.example.BrandDarkThemeCatalog",
        name: "Brand Dark",
        group: "Brand",
        dark: true,
        tokensFile: "themes/com.example.branddarkthemecatalog.dtcg.json",
      },
      {
        id: "com.example.HighContrastThemeCatalog",
        name: "High Contrast",
        tokensFile: "themes/com.example.highcontrastthemecatalog.dtcg.json",
      },
    ]);

    // Every declared path is really on disk and carries THAT theme's tokens —
    // including the typeface, which is the half a colour-only export drops.
    expect(result.themeTokensPaths).toHaveLength(2);
    for (const entry of manifest.themes) {
      const dtcg = JSON.parse(await readFile(join(out, entry.tokensFile), "utf8"));
      expect(dtcg.color.primary.$value).toBe(entry.dark ? "#4dd0e1" : "#000000");
    }
    const brand = JSON.parse(
      await readFile(join(out, manifest.themes[0].tokensFile), "utf8"),
    );
    expect(brand.type.titleMedium.$value.fontFamily).toBe("Rubik");
  });

  it("writes the run's verdicts as parity/findings.json when a caller has any", async () => {
    const catalog: Catalog = {
      meta: { system: "x", title: "X" },
      components: [
        { componentId: "A", variants: { ideal: [{ state: "default", uri: PNG_DATA_URI, width: 1, height: 1 }] }, greenlines: [], redlines: [] },
      ],
    };
    const result = await writeCatalog(catalog, out, {
      parityFindings: [
        {
          previewIds: ["a__ideal__default"],
          referenceId: "design-a",
          verdict: {
            componentId: "A",
            status: "fail",
            findings: [
              {
                kind: "token",
                severity: "error",
                message: "spacing.padding: 24 vs spec 16",
                detail: { token: "spacing.padding", expected: 16, actual: 24 },
              },
            ],
          },
          candidate: { root: { role: "A", bounds: { x: 0, y: 0, width: 20, height: 10 } } },
        },
      ],
    });
    expect(result.parityFindingsPath).toBe(join(out, "parity", "findings.json"));
    const doc = JSON.parse(await readFile(result.parityFindingsPath, "utf8"));
    expect(doc.schema).toBe("compose-preview-parity-findings/v1");
    const set = doc.previews["a__ideal__default"][0];
    expect(set.referenceId).toBe("design-a");
    expect(set.findings[0].detail).toEqual({
      token: "spacing.padding",
      expected: "16",
      actual: "24",
    });
    expect(set.findings[0].anchors).toEqual([
      { side: "actual", bounds: { x: 0, y: 0, width: 20, height: 10 } },
    ]);
  });

  it("writes no findings file for an export with no verdicts, or verdicts with no findings", async () => {
    const catalog: Catalog = {
      meta: { system: "x", title: "X" },
      components: [
        { componentId: "A", variants: { ideal: [{ state: "default", uri: PNG_DATA_URI, width: 1, height: 1 }] }, greenlines: [], redlines: [] },
      ],
    };
    expect((await writeCatalog(catalog, out)).parityFindingsPath).toBeUndefined();
    const clean = await writeCatalog(catalog, out, {
      parityFindings: [
        {
          previewIds: ["a"],
          verdict: { componentId: "A", status: "pass", findings: [] },
        },
      ],
    });
    expect(clean.parityFindingsPath).toBeUndefined();
  });

  it("skips token/figma files when the catalog has no themeTokens", async () => {
    const catalog: Catalog = {
      meta: { system: "x", title: "X" },
      components: [
        { componentId: "A", variants: { ideal: [{ state: "default", uri: PNG_DATA_URI, width: 1, height: 1 }] }, greenlines: [], redlines: [] },
      ],
    };
    const result = await writeCatalog(catalog, out, { figmaVariables: true });
    expect(result.tokensPath).toBeUndefined();
    expect(result.figmaPath).toBeUndefined();
    expect(result.imageCount).toBe(1);
  });
});
