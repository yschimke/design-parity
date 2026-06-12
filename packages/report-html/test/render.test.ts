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
