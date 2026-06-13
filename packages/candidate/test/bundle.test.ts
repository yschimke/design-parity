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
  bundleCandidateSource,
  cliRenderSource,
  localComposeWebSource,
  daemonSource,
  firstAvailable,
  InvalidBundleError,
  NotImplementedError,
  type CandidateSource,
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

  it("fails clearly on bytes with no embedded bundle", () => {
    // A bare PNG signature with no appended zip is not a bundle.
    const notABundle = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8);
    expect(() => parsePreviewBundle(notABundle)).toThrow(InvalidBundleError);
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

  it("daemonSource throws a clear not-implemented error", async () => {
    const source = daemonSource();
    expect(source.kind).toBe("daemon");
    await expect(source.getCandidate("x", ctx)).rejects.toThrow(
      /not implemented/,
    );
  });
});
