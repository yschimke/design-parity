import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type {
  CandidateRender,
  DesignReference,
  Verdict,
} from "@design-parity/core";

import { renderHtmlReport } from "../src/index.js";
import type { DiffImage } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repoRoot, p), "utf8")) as T;
}

const loadInputs = async () => {
  const reference = await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  );
  const candidate = await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  );
  // A representative verdict mirroring the diff engine's output shape.
  const verdict: Verdict = {
    componentId: reference.componentId,
    status: "fail",
    findings: [
      {
        kind: "contrast",
        severity: "error",
        message: "dark-theme label contrast fails WCAG AA",
        detail: { theme: "dark", ratio: 3.9, required: 4.5 },
      },
      {
        kind: "token",
        severity: "error",
        message: "padding 12dp vs spec 16dp",
        detail: { token: "spacing.padding", expected: 16, actual: 12, delta: 4 },
      },
      {
        kind: "token",
        severity: "warn",
        message: "dark container colour drifted",
        detail: {
          token: "colors.container.dark",
          expected: "#8A82FF",
          actual: "#7A72F0",
        },
      },
      {
        kind: "visual",
        severity: "info",
        message: "dark theme differs 1.2%",
      },
    ],
    visualScores: {
      "default/light/compact": 0,
      "default/dark/compact": 0.012,
    },
  };
  return { reference, candidate, verdict };
};

// A 1x1 transparent PNG (deterministic bytes) standing in for a diff heatmap.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("renderHtmlReport on the figma button fixtures", () => {
  it("emits one self-contained HTML doc with the componentId, status, and findings", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const diffImages: DiffImage[] = [
      { key: "default/light/compact", png: ONE_PX_PNG },
      { key: "default/dark/compact", png: ONE_PX_PNG },
    ];
    const html = renderHtmlReport({
      reference,
      candidate,
      verdict,
      diffImages,
      repoRoot,
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("ui/Button.kt#PrimaryButton");
    expect(html).toContain("Fail");
    expect(html).toContain("dark-theme label contrast fails WCAG AA");
    expect(html).toContain("padding 12dp vs spec 16dp");
    // token expected-vs-actual surfaced from finding.detail
    expect(html).toContain("expected 16");
    expect(html).toContain("actual 12");
  });

  it("lays the variants out as a matrix with light/dark theme columns and a candidate preview per intersection", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const html = renderHtmlReport({ reference, candidate, verdict, repoRoot });

    // A matrix table with the themes as columns (light before dark).
    expect(html).toContain('<table class="matrix">');
    const lightCol = html.indexOf(">Light<");
    const darkCol = html.indexOf(">Dark<");
    expect(lightCol).toBeGreaterThan(-1);
    expect(darkCol).toBeGreaterThan(lightCol);
    // A row header keyed by state (· size).
    expect(html).toContain('class="matrix-row"');
    expect(html).toContain("default · compact");
    // Each intersection shows a candidate preview that anchors to its detail.
    expect(html).toContain('class="matrix-img"');
    expect(html).toMatch(/<a class="matrix-link" href="#v-default-dark-compact">/);
    expect(html).toContain('id="v-default-dark-compact"');
  });

  it("overlays toggleable annotation layers driven by the candidate semantics", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const html = renderHtmlReport({ reference, candidate, verdict, repoRoot });

    // The toggle bar with both layers.
    expect(html).toContain('data-anno-layer="spacing"');
    expect(html).toContain('data-anno-layer="typography"');
    // The candidate panel carries an SVG overlay with both layer groups.
    expect(html).toContain('<svg class="anno"');
    expect(html).toContain('<g data-layer="spacing">');
    expect(html).toContain('<g data-layer="typography">');
    // Box-model detail (the fixture button is 160×48, r8, p12) and the type callout.
    expect(html).toContain("160×48 r8 p12");
    expect(html).toContain("Roboto · 14sp · 500");
    // Layers ship hidden; the inline script toggles them on.
    expect(html).toContain(".anno g[data-layer]{display:none}");
    expect(html).toContain("data-anno-layer");
  });

  it("omits the annotation controls when no panel can draw them", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    // A candidate whose semantics carry no bounds ⇒ nothing to annotate.
    const bare = { ...candidate, semantics: { root: { role: "group" } } };
    const html = renderHtmlReport({ reference: { ...reference, layout: undefined }, candidate: bare, verdict, repoRoot });
    expect(html).not.toContain('data-anno-layer="spacing"');
    expect(html).not.toContain('<svg class="anno"');
  });

  it("inlines images as data URIs and references no external assets", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const html = renderHtmlReport({
      reference,
      candidate,
      verdict,
      diffImages: [{ key: "default/dark/compact", png: ONE_PX_PNG }],
      repoRoot,
    });

    expect(html).toContain("data:image/png;base64,");
    // no external requests of any kind
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("passes a data:-URI image through inline without reading a file", async () => {
    const dataUri = `data:image/png;base64,${ONE_PX_PNG.toString("base64")}`;
    const reference: DesignReference = {
      componentId: "ui/Card.kt#OfferCard",
      source: "bundle",
      linkMethod: "manifest",
      referenceImages: [
        { state: "default", theme: "light", uri: dataUri, width: 1, height: 1 },
      ],
    };
    const candidate: CandidateRender = {
      componentId: "ui/Card.kt#OfferCard",
      images: [
        { state: "default", theme: "light", uri: dataUri, width: 1, height: 1 },
      ],
      semantics: { root: { role: "image" } },
    };
    const verdict: Verdict = {
      componentId: "ui/Card.kt#OfferCard",
      status: "pass",
      findings: [],
      visualScores: { "default/light": 0 },
    };

    // A repoRoot that does not exist proves the data: URI is passed through and
    // never resolved/read from disk.
    const html = renderHtmlReport({
      reference,
      candidate,
      verdict,
      repoRoot: "/no/such/root",
    });

    expect(html).toContain(dataUri);
  });

  it("is deterministic: two renders are byte-identical", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const diffImages: DiffImage[] = [
      { key: "default/dark/compact", png: ONE_PX_PNG },
    ];
    const a = renderHtmlReport({ reference, candidate, verdict, diffImages, repoRoot });
    const b = renderHtmlReport({ reference, candidate, verdict, diffImages, repoRoot });
    expect(a).toBe(b);
  });

  it("degrades cleanly with no images (token/semantic-only verdict) — findings still render", () => {
    const verdict: Verdict = {
      componentId: "ui/Card.kt#OfferCard",
      status: "warn",
      findings: [
        {
          kind: "token",
          severity: "warn",
          message: "radius 4dp vs spec 8dp",
          detail: { token: "radius.corner", expected: 8, actual: 4 },
        },
      ],
    };
    const html = renderHtmlReport({
      reference: {
        componentId: "ui/Card.kt#OfferCard",
        source: "stitch",
        linkMethod: "manifest",
        referenceImages: [],
      },
      candidate: {
        componentId: "ui/Card.kt#OfferCard",
        images: [],
        semantics: { root: { role: "group" } },
      },
      verdict,
    });

    expect(html).toContain("ui/Card.kt#OfferCard");
    expect(html).toContain("radius 4dp vs spec 8dp");
    expect(html).toContain("findings only");
    expect(html).not.toMatch(/https?:\/\//);
  });
});
