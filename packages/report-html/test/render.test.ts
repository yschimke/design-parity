import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import type {
  CandidateRender,
  DesignReference,
  Verdict,
} from "@design-parity/core";

import { renderHtmlReport, toDisplayFrame } from "../src/index.js";
import type { DiffImage } from "../src/index.js";

describe("toDisplayFrame", () => {
  it("scales the candidate's device-px geometry into the reference's dp space", () => {
    // Candidate rendered at 2.625× density (411dp → 1078px); reference is dp.
    const cand = {
      root: {
        role: "group",
        bounds: { x: 0, y: 0, width: 1078, height: 2399 },
        children: [{ role: "text", label: "x", bounds: { x: 105, y: 105, width: 263, height: 71 } }],
      },
    };
    const ref = { root: { role: "group", bounds: { x: 0, y: 0, width: 411, height: 914 } } };
    const out = toDisplayFrame(cand, ref)!;
    expect(out.root.bounds!.width).toBeCloseTo(411, 0);
    const child = out.root.children![0]!.bounds!;
    expect(child.width).toBeCloseTo(100, 0); // 263 px → ~100 dp
    expect(child.x).toBeCloseTo(40, 0); // 105 px → ~40 dp
  });

  it("is a no-op when frames already match or are absent", () => {
    const t = { root: { role: "group", bounds: { x: 0, y: 0, width: 411, height: 914 } } };
    expect(toDisplayFrame(t, t)).toBe(t);
    expect(toDisplayFrame(t, { root: { role: "group" } })).toBe(t); // ref has no frame
  });
});

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
    // Box-model detail (the fixture button is 160×48, r8, p12) and the grouped type settings.
    expect(html).toContain("160×48 r8 p12");
    expect(html).toContain('data-summary-layer="typography"');
    expect(html).toContain('<span class="type-side">Candidate</span>');
    expect(html).toContain("Roboto");
    expect(html).toContain("14sp");
    expect(html).toContain("wght 500");
    expect(html).toContain("1 usage");
    expect(html).toContain(">A</text>");
    expect(html).toContain('data-type-row="A" tabindex="0"');
    expect(html).toContain("addEventListener('mouseenter'");
    // Layers ship hidden; the inline script toggles them on.
    expect(html).toContain(".anno g[data-layer]{display:none}");
    expect(html).toContain("data-anno-layer");
    // The control bar (mode selector + annotation toggles) sits above the views
    // it governs, ahead of the slider.
    expect(html.indexOf('class="view-controls"')).toBeLessThan(
      html.indexOf('class="views"'),
    );
    expect(html.indexOf('class="anno-controls"')).toBeLessThan(
      html.indexOf('class="overlay"'),
    );
    // Each toggle scopes to its own variant.
    expect(html).toContain("closest('.variant')");
  });

  it("highlights parameters overridden from the most-used form of a typography token", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const children = candidate.semantics!.root.children!;
    children.push(
      {
        ...children[0]!,
        label: "Default copy",
        bounds: { x: 12, y: 38, width: 80, height: 20 },
      },
      {
        ...children[0]!,
        label: "Emphasis",
        bounds: { x: 12, y: 62, width: 80, height: 20 },
        tokens: {
          typography: {
            label: { fontFamily: "Roboto", fontSize: 14, fontWeight: 700, lineHeight: 20 },
          },
        },
      },
    );
    const html = renderHtmlReport({ reference, candidate, verdict, repoRoot });
    expect(html).toContain('class="type-changed type-override" title="Changed from label default">wght 700</span>');
  });

  it("offers one mutually-exclusive view mode selector instead of showing every view at once", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const html = renderHtmlReport({
      reference,
      candidate,
      verdict,
      diffImages: [{ key: "default/light/compact", png: ONE_PX_PNG }],
      repoRoot,
    });
    // A radio group scoped per variant with Side by side / Differences / Slider.
    expect(html).toContain('class="mode-select"');
    expect(html).toContain('type="radio"');
    expect(html).toContain("Side by side");
    expect(html).toContain("Differences");
    expect(html).toContain("Slider");
    // Side-by-side is the default; the diff heatmap and the slider are the same
    // widget hidden behind their own modes, never shown together.
    expect(html).toMatch(/value="side"[^>]*checked/);
    expect(html).toContain('data-view-value="diff" hidden');
    expect(html).toContain('data-view-value="slider" hidden');
    // The mode script hides the non-selected views by their panel id.
    expect(html).toContain("data-view-panel");
  });

  it("adds a layout-delta layer + toggle when the verdict carries layout findings", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    // The fixture's candidate has a 'Continue' text node; flag it as shifted.
    const withLayout: Verdict = {
      ...verdict,
      findings: [
        ...verdict.findings,
        { kind: "layout", severity: "warn", message: 'layout "Continue": offset (0, 2)', detail: { label: "Continue", dx: 0, dy: 2, dw: 0, dh: 0 } },
      ],
    };
    const html = renderHtmlReport({ reference, candidate, verdict: withLayout, repoRoot });
    expect(html).toContain('data-anno-layer="layout"');
    expect(html).toContain('<g data-layer="layout">');
    expect(html).toContain("Δpos 0,+2");
  });

  it("omits the layout toggle when there are no layout findings", async () => {
    const { reference, candidate, verdict } = await loadInputs();
    const html = renderHtmlReport({ reference, candidate, verdict, repoRoot });
    // Box-model/typography toggles present, but no layout toggle.
    expect(html).toContain('data-anno-layer="spacing"');
    expect(html).not.toContain('data-anno-layer="layout"');
    // The (empty) layout group still ships in the SVG; the toggle just isn't offered.
    expect(html).toContain('<g data-layer="layout"></g>');
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

describe("renderHtmlReport with an SVG reference", () => {
  const componentId = "ui/Card.kt#VectorCard";
  const candidate: CandidateRender = {
    componentId,
    images: [{ state: "default", uri: "data:image/png;base64,AAAA", width: 240, height: 160 }],
    semantics: { root: { role: "group" } },
  };
  const verdict: Verdict = { componentId, status: "pass", findings: [] };

  it("inlines a committed .svg reference crisply and prefers vector rendering", () => {
    const dir = mkdtempSync(join(tmpdir(), "dp-svg-"));
    writeFileSync(
      join(dir, "card.svg"),
      '<svg viewBox="0 0 240 160"><rect width="240" height="160" rx="8" fill="#74F8E5"/></svg>',
    );
    const reference: DesignReference = {
      componentId,
      source: "claude-design",
      linkMethod: "manifest",
      referenceImages: [{ state: "default", uri: "card.svg", width: 240, height: 160 }],
    };
    const html = renderHtmlReport({ reference, candidate, verdict, repoRoot: dir });

    // The .svg is inlined with the vector mime, not mis-wrapped as image/png.
    expect(html).toContain("data:image/svg+xml;base64,");
    // The reference panel image opts out of the pixelated rendering PNGs get.
    expect(html).toMatch(/<img class="panel-img is-vector"[^>]*data-role="reference"/);
    expect(html).toContain(".matrix-img.is-vector,.panel-img.is-vector{image-rendering:auto}");
  });

  it("passes a data:image/svg reference through untouched and marks it vector", () => {
    const svg = Buffer.from('<svg viewBox="0 0 10 10"></svg>').toString("base64");
    const reference: DesignReference = {
      componentId,
      source: "claude-design",
      linkMethod: "manifest",
      referenceImages: [
        { state: "default", uri: `data:image/svg+xml;base64,${svg}`, width: 10, height: 10 },
      ],
    };
    const html = renderHtmlReport({ reference, candidate, verdict });
    expect(html).toMatch(/<img class="panel-img is-vector"[^>]*data-role="reference"/);
    // A raster PNG candidate in the same report keeps the pixelated default.
    expect(html).toMatch(/<img class="panel-img"[^>]*data-role="candidate"/);
  });
});
