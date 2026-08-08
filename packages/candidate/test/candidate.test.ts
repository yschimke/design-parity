import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";

import type { CandidateRender } from "@design-parity/core";

import {
  renderCandidate,
  SpawnComposePreviewCli,
  MissingComposePreviewError,
  NoPreviewsError,
  themeFromUiMode,
  themeFromName,
  themeForPreview,
  sizeFromParams,
  normalizeSemantics,
  parseShow,
  readPngSize,
  type CommandRunner,
  type RunResult,
} from "../src/index.js";

// The design-parity repo root; the sample module + fixtures live under it.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = (p: string) => resolve(repoRoot, p);

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(fixture(p), "utf8")) as T;
}

// --- A fake CLI: canned `--version` + `show --json`, real fixture PNGs. ------

const lightPng = fixture("fixtures/candidate/button-primary.light.png");
const darkPng = fixture("fixtures/candidate/button-primary.dark.png");

const showJson = JSON.stringify([
  {
    id: "PrimaryButton_light",
    pngPath: lightPng,
    sha256: "aaaa",
    changed: true,
    params: { uiMode: 0x10, widthDp: 160, heightDp: 48 },
  },
  {
    id: "PrimaryButton_dark",
    pngPath: darkPng,
    sha256: "bbbb",
    changed: true,
    params: { uiMode: 0x20, widthDp: 160, heightDp: 48 },
  },
]);

// The a11y/hierarchy data product for the light capture; mirrors the fixture's
// semantics (theme is derived from uiMode when omitted, but we set it here).
const lightHierarchy = {
  theme: "light",
  root: {
    role: "button",
    label: "Continue",
    bounds: { x: 0, y: 0, width: 160, height: 48 },
    tokens: {
      spacing: { padding: 12 },
      radius: { corner: 8 },
      colors: {
        "container.light": "#645AFF",
        "container.dark": "#7A72F0",
        label: "#FFFFFF",
      },
    },
    children: [
      {
        role: "text",
        label: "Continue",
        bounds: { x: 12, y: 14, width: 136, height: 20 },
        tokens: {
          typography: {
            label: {
              fontFamily: "Roboto",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 20,
            },
          },
        },
      },
    ],
  },
};

const lightHierarchyPath = join(
  repoRoot,
  "build/compose-previews/data/PrimaryButton_light/a11y/hierarchy.json",
);

function fakeRunner(versionCode = 0, showResult?: RunResult): CommandRunner {
  return {
    async run(_command, args): Promise<RunResult> {
      if (args[0] === "--version") {
        return { code: versionCode, stdout: "compose-preview 0.14.0", stderr: "" };
      }
      return showResult ?? { code: 0, stdout: showJson, stderr: "" };
    },
  };
}

// Reads real fixture PNGs; serves the canned hierarchy for the light preview.
async function fakeReadFile(path: string): Promise<Uint8Array> {
  if (path.endsWith(".png")) return readFile(path);
  if (path === lightHierarchyPath) {
    return Buffer.from(JSON.stringify(lightHierarchy), "utf8");
  }
  throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

describe("renderCandidate", () => {
  it("emits a CandidateRender matching the golden fixture shape", async () => {
    const cli = new SpawnComposePreviewCli({
      projectDir: repoRoot,
      runner: fakeRunner(),
      readFile: fakeReadFile,
    });
    const result = await renderCandidate({
      componentId: "ui/Button.kt#PrimaryButton",
      projectDir: repoRoot,
      repoRoot,
      filter: "PrimaryButton",
      cli,
    });

    const golden = await readJson<CandidateRender>(
      "fixtures/candidate/button-primary.candidate.json",
    );
    expect(result).toEqual(golden);
  });

  it("produces a clear, actionable error when the CLI is missing", async () => {
    const enoent = Object.assign(new Error("spawn compose-preview ENOENT"), {
      code: "ENOENT",
    });
    const cli = new SpawnComposePreviewCli({
      projectDir: repoRoot,
      runner: {
        async run() {
          throw enoent;
        },
      },
    });
    const promise = renderCandidate({
      componentId: "ui/Button.kt#PrimaryButton",
      projectDir: repoRoot,
      cli,
    });
    await expect(promise).rejects.toBeInstanceOf(MissingComposePreviewError);
    await expect(promise).rejects.toThrow(/compose-preview --version/);
  });

  it("maps exit code 3 to NoPreviewsError", async () => {
    const cli = new SpawnComposePreviewCli({
      projectDir: repoRoot,
      runner: fakeRunner(0, { code: 3, stdout: "", stderr: "no previews" }),
      readFile: fakeReadFile,
    });
    await expect(
      renderCandidate({
        componentId: "ui/Button.kt#PrimaryButton",
        projectDir: repoRoot,
        cli,
      }),
    ).rejects.toBeInstanceOf(NoPreviewsError);
  });
});

describe("param mappers", () => {
  it("derives theme from Android uiMode ints and strings", () => {
    expect(themeFromUiMode(0x20)).toBe("dark");
    expect(themeFromUiMode(0x10)).toBe("light");
    expect(themeFromUiMode("UI_MODE_NIGHT_YES")).toBe("dark");
    expect(themeFromUiMode("notnight")).toBe("light");
    expect(themeFromUiMode(undefined)).toBeUndefined();
  });

  it("derives theme from a preview-id trailing token, ignoring embedded words (#48)", () => {
    expect(themeFromName("ee.app.Tile_LightOn_Dark")).toBe("dark");
    expect(themeFromName("Tile_Dark")).toBe("dark");
    expect(themeFromName("Preview (dark)")).toBe("dark");
    expect(themeFromName("Foo_Night")).toBe("dark");
    expect(themeFromName("Tile_Light")).toBe("light");
    // The trial's trap: "LightOn" is not a light-theme variant.
    expect(themeFromName("ee.app.Tile_LightOn")).toBeUndefined();
    expect(themeFromName("PrimaryButton")).toBeUndefined();
    expect(themeFromName(undefined)).toBeUndefined();
  });

  it("themeForPreview prefers explicit hint > uiMode > name convention (#48)", () => {
    // Explicit hint wins even against a contradicting name/uiMode.
    expect(themeForPreview({ theme: "dark", uiMode: 0x10 }, "Foo_Light")).toBe("dark");
    // No hint → uiMode.
    expect(themeForPreview({ uiMode: 0x20 }, "Foo_Light")).toBe("dark");
    // No hint, uiMode unset (CompositionLocal theming) → name convention.
    expect(themeForPreview({ uiMode: 0 }, "Tile_LightOn_Dark")).toBe("dark");
    expect(themeForPreview({}, "Tile_LightOn")).toBeUndefined();
  });

  it("buckets width into Material window-size classes", () => {
    expect(sizeFromParams({ widthDp: 160 })).toBe("compact");
    expect(sizeFromParams({ widthDp: 700 })).toBe("medium");
    expect(sizeFromParams({ widthDp: 1200 })).toBe("expanded");
    expect(sizeFromParams({ device: "Pixel 7" })).toBe("Pixel 7");
    expect(sizeFromParams({})).toBeUndefined();
  });
});

describe("normalizeSemantics", () => {
  it("normalizes alternate label/bounds field names", () => {
    const tree = normalizeSemantics(
      {
        root: {
          contentDescription: "Save",
          bounds: { left: 4, top: 8, right: 44, bottom: 28 },
        },
      },
      "dark",
    );
    expect(tree).toEqual({
      theme: "dark",
      root: {
        label: "Save",
        bounds: { x: 4, y: 8, width: 40, height: 20 },
      },
    });
  });

  it("returns undefined when there is no root", () => {
    expect(normalizeSemantics(undefined)).toBeUndefined();
    expect(normalizeSemantics({})).toBeUndefined();
  });

  it("carries testTag as a name, without letting it stand in for the label", () => {
    // A third of a published catalog's annotations had no title at all. The test
    // tag names them — but folding it into `label` would make a node with no
    // accessible name silently pass the missing-label check.
    const tree = normalizeSemantics({
      root: { testTag: "message-row", boundsInRoot: "0,0,10,10" },
    });
    expect(tree?.root.testTag).toBe("message-row");
    expect(tree?.root.label).toBeUndefined();
  });

  it("reads compose/semantics 'boundsInRoot' string geometry from the bundle", () => {
    // The compose-preview bundle emits geometry as "left,top,right,bottom" px
    // (not the object form). Without parsing it the bundle path had no bounds,
    // so candidate overlays + the structural layout diff stayed empty.
    const tree = normalizeSemantics({
      root: {
        boundsInRoot: "0,0,1078,2399",
        children: [{ role: "Button", label: "Go", boundsInRoot: "42,44,216,149" }],
      },
    });
    expect(tree?.root.bounds).toEqual({ x: 0, y: 0, width: 1078, height: 2399 });
    expect(tree?.root.children?.[0]?.bounds).toEqual({ x: 42, y: 44, width: 174, height: 105 });
  });

  it("prefers the object bounds form over the string when both are present", () => {
    const tree = normalizeSemantics({
      root: { bounds: { x: 1, y: 2, width: 3, height: 4 }, boundsInRoot: "0,0,9,9" },
    });
    expect(tree?.root.bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("reads the flat layoutFontSize into typography (the bundle's pre-v6 size)", () => {
    const tree = normalizeSemantics({
      root: { role: "text", label: "Hi", layoutFontSize: "14.0sp" },
    });
    expect(tree?.root.tokens?.typography).toEqual({ text: { fontSize: 14 } });
  });

  it("reads the v6 typography object (face/weight/size/line-height)", () => {
    const tree = normalizeSemantics({
      root: {
        role: "text",
        label: "Hi",
        typography: { fontFamily: "Roboto", fontWeight: 500, fontSize: "16.0sp", lineHeight: "20.0sp" },
      },
    });
    expect(tree?.root.tokens?.typography?.["text"]).toMatchObject({
      fontFamily: "Roboto",
      fontWeight: 500,
      fontSize: 16,
      lineHeight: 20,
    });
  });

  it("reads resolved fg/bg colours from layout*Color into role keys", () => {
    const tree = normalizeSemantics({
      root: {
        role: "text",
        label: "Hi",
        layoutForegroundColor: "#FF161D1B",
        layoutBackgroundColor: "#FFF4FBF8",
      },
    });
    expect(tree?.root.tokens?.colors).toEqual({
      fg: "#161d1bff",
      bg: "#f4fbf8ff",
    });
  });

  it("translates the compose/semantics producer token shape (#1897)", () => {
    const tree = normalizeSemantics({
      root: {
        role: "button",
        layoutForegroundColor: "#FFFFFFFF",
        tokens: {
          backgroundColor: "#FF006A60",
          cornerRadius: "12.0dp",
          padding: {
            start: "16.0dp",
            top: "16.0dp",
            end: "16.0dp",
            bottom: "16.0dp",
          },
        },
      },
    });
    expect(tree?.root.tokens).toEqual({
      colors: { fg: "#ffffffff", bg: "#006a60ff" },
      radius: { corner: 12 },
      spacing: {
        paddingStart: 16,
        paddingTop: 16,
        paddingEnd: 16,
        paddingBottom: 16,
        padding: 16,
      },
    });
  });

  it("translates the #1908 token-capture fields (gap, border, circle radius)", () => {
    const tree = normalizeSemantics({
      root: {
        tokens: {
          // outline colour from Modifier.border, gap from Arrangement.spacedBy, and a
          // CircleShape avatar whose percent corner resolved to a dp radius upstream.
          borderColor: "#FFCAC4D0",
          gap: "8.0dp",
          shape: "circle",
          cornerRadius: "18.0dp",
        },
      },
    });
    expect(tree?.root.tokens).toEqual({
      colors: { border: "#cac4d0ff" },
      radius: { corner: 18 },
      spacing: { gap: 8 },
    });
  });

  it("passes a core DesignTokens bag through unchanged", () => {
    const tree = normalizeSemantics({
      root: {
        tokens: {
          spacing: { padding: 12 },
          colors: { "container.light": "#645AFF" },
        },
      },
    });
    expect(tree?.root.tokens).toEqual({
      spacing: { padding: 12 },
      colors: { "container.light": "#645AFF" },
    });
  });
});

describe("parseShow", () => {
  it("tolerates a top-level array and a { previews: [] } envelope", () => {
    expect(parseShow("[]")).toEqual([]);
    expect(parseShow("")).toEqual([]);
    const wrapped = parseShow(
      JSON.stringify({ previews: [{ id: "A", path: "/x/a.png" }] }),
    );
    expect(wrapped).toEqual([{ id: "A", pngPath: "/x/a.png", params: {} }]);
  });
});

describe("readPngSize", () => {
  it("reads pixel dimensions from a real fixture PNG", async () => {
    const bytes = await readFile(lightPng);
    expect(readPngSize(bytes)).toEqual({ width: 160, height: 48 });
  });
});
