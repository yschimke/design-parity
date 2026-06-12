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
