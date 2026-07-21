import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import type {
  CandidateRender,
  Correspondence,
  DesignReference,
  ReferenceAdapter,
} from "@design-parity/core";

import {
  orchestrate,
  createAdapterRegistry,
  renderReport,
  renderBootstrapNotice,
  REPORT_MARKER,
  CMP_PROMOTION,
  specTokenKey,
  type AdapterRegistry,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const readJson = async <T>(p: string): Promise<T> =>
  JSON.parse(await readFile(resolve(repoRoot, p), "utf8")) as T;

const corr: Correspondence = {
  code: "ui/Button.kt#PrimaryButton",
  source: "figma",
  ref: "figma:AbCdEf123456/1:42",
  linkMethod: "code-connect",
  confidence: "high",
};

const adapterReturning = (ref: DesignReference): ReferenceAdapter => ({
  source: "figma",
  resolve: async () => ref,
});
const throwingAdapter: ReferenceAdapter = {
  source: "figma",
  resolve: async () => {
    throw new Error("boom");
  },
};
/** A full registry that routes every source to one adapter (test convenience). */
const reg = (a: ReferenceAdapter): AdapterRegistry => ({
  figma: a,
  stitch: a,
  "claude-design": a,
});

const load = async () => {
  const reference = await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  );
  const candidate = await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  );
  // The resolved compose theme behind the render, for the design-system audit.
  candidate.semantics.themeTokens = {
    colors: { "container.light": "#645AFF", "container.dark": "#7A72F0" },
  };
  return { reference, candidate };
};

describe("createAdapterRegistry", () => {
  it("wires all three sources with correct source tags", () => {
    const r = createAdapterRegistry();
    expect(r.figma.source).toBe("figma");
    expect(r.stitch.source).toBe("stitch");
    expect(r["claude-design"].source).toBe("claude-design");
  });
});

describe("orchestrate (golden figma button vs candidate)", () => {
  it("produces a failing verdict and blocks under design-led", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "design-led",
    });

    expect(report.status).toBe("fail");
    expect(report.blocked).toBe(true);
    const r0 = report.results[0]!;
    expect(r0.status).toBe("ok");
    expect(r0.verdict?.findings.some((f) => f.kind === "contrast")).toBe(true);
    expect(r0.verdict?.findings.some((f) => f.kind === "token")).toBe(true);
  });

  it("reports a shared design-system drift once across components", async () => {
    const { reference, candidate } = await load();
    const ds = (i: number) =>
      (report.results[i]!.verdict?.findings ?? []).filter(
        (f) => f.detail?.scope === "design-system",
      );
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [
        { ...corr, code: "ui/A.kt#A" },
        { ...corr, code: "ui/B.kt#B" },
      ],
      candidate: () => candidate,
      direction: "design-led",
    });
    // Same palette → the container drift surfaces on the first component only.
    expect(ds(0)).toHaveLength(1);
    expect(ds(1)).toHaveLength(0);
  });

  it("is advisory (not blocked) under code-led", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "code-led",
    });
    expect(report.status).toBe("fail");
    expect(report.blocked).toBe(false);
  });

  it("merges declared spec tokens into a token-less reference (#89)", async () => {
    const { candidate } = await load();
    // A bundle/claude-design-style reference the adapter resolved without tokens.
    const bare: DesignReference = {
      componentId: corr.code,
      source: "figma",
      linkMethod: "code-connect",
      referenceImages: [],
    };
    const declared = new Map([
      [specTokenKey(corr.code, corr.source), { colors: { onSurface: "#161D1B" } }],
    ]);
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(bare)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "code-led",
      referenceTokens: declared,
    });
    expect(report.results[0]!.reference?.tokens?.colors?.onSurface).toBe("#161D1B");
  });

  it("fails soft when an adapter throws — error does not escalate or block", async () => {
    const report = await orchestrate({
      repoRoot,
      registry: reg(throwingAdapter),
      correspondences: [corr],
      candidate: () => undefined,
      direction: "design-led",
    });
    expect(report.results[0]!.status).toBe("error");
    expect(report.status).toBe("pass");
    expect(report.blocked).toBe(false);
    expect(report.warnings.join(" ")).toMatch(/boom/);
  });

  it("skips a component with no candidate render", async () => {
    const { reference } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => undefined,
      direction: "code-led",
    });
    expect(report.results[0]!.status).toBe("skipped");
  });
});

describe("run output artifacts (#49, #50)", () => {
  it("writes each component's triptychs + HTML page into its own subdir", async () => {
    const { reference, candidate } = await load();
    const outDir = await mkdtemp(join(tmpdir(), "dp-out-"));
    try {
      const corrA = { ...corr, code: "ui/Tile.kt#LightOn" };
      const corrB = { ...corr, code: "ui/Tile.kt#LightOn_Dark" };
      const report = await orchestrate({
        repoRoot,
        registry: reg(adapterReturning(reference)),
        correspondences: [corrA, corrB],
        candidate: () => candidate,
        direction: "code-led",
        outDir,
      });

      const [rA, rB] = report.results;
      // Each component got its own HTML page under its own sanitised subdir (#50).
      expect(rA!.reportPath).toBe(
        join(outDir, "ui-Tile-kt-LightOn", "report.html"),
      );
      expect(rB!.reportPath).toBe(
        join(outDir, "ui-Tile-kt-LightOn_Dark", "report.html"),
      );

      // The page is self-contained HTML and names the component.
      const htmlA = await readFile(rA!.reportPath!, "utf8");
      expect(htmlA).toContain("<!doctype html>");

      // Triptychs land under the per-component subdir — siblings never collide,
      // the bug #49 reported (all four tiles were default/compact).
      const pathsA = (rA!.triptychs ?? []).map((t) => t.path);
      const pathsB = (rB!.triptychs ?? []).map((t) => t.path);
      expect(pathsA.length).toBeGreaterThan(0);
      for (const p of pathsA) {
        expect(p).toContain(join(outDir, "ui-Tile-kt-LightOn"));
        expect(pathsB).not.toContain(p);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("diffs one code against several sources into per-source dirs (#106)", async () => {
    const { reference, candidate } = await load();
    const outDir = await mkdtemp(join(tmpdir(), "dp-out-"));
    try {
      // The same code handle bound to two sources — the head-to-head #106 asks
      // for (Claude Design + Stitch on one screen).
      const stitch: Correspondence = {
        ...corr,
        source: "stitch",
        linkMethod: "manifest",
      };
      const claude: Correspondence = {
        ...corr,
        source: "claude-design",
        linkMethod: "manifest",
      };
      const report = await orchestrate({
        repoRoot,
        registry: reg(adapterReturning(reference)),
        correspondences: [stitch, claude],
        candidate: () => candidate,
        direction: "code-led",
        outDir,
        index: { repoSlug: "o/r", branch: "design-parity/main" },
      });

      // Two results, one per source, each keyed by (code, source) — no collision.
      const [rS, rC] = report.results;
      expect(rS!.source).toBe("stitch");
      expect(rC!.source).toBe("claude-design");
      expect(rS!.reportPath).toBe(
        join(outDir, "ui-Button-kt-PrimaryButton-stitch", "report.html"),
      );
      expect(rC!.reportPath).toBe(
        join(outDir, "ui-Button-kt-PrimaryButton-claude-design", "report.html"),
      );
      // Both reports were actually written to their own dirs (the second didn't
      // overwrite the first).
      expect(await readFile(rS!.reportPath!, "utf8")).toContain("<!doctype html>");
      expect(await readFile(rC!.reportPath!, "utf8")).toContain("<!doctype html>");

      // The landing page carries a Source column so the two rows are told apart.
      const readme = await readFile(join(outDir, "README.md"), "utf8");
      expect(readme).toContain("| Source |");
      expect(readme).toContain("stitch");
      expect(readme).toContain("claude-design");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("inlines the pixelmatch heatmap into the page (#47 → #50)", async () => {
    const { reference, candidate } = await load();
    const outDir = await mkdtemp(join(tmpdir(), "dp-out-"));
    try {
      const report = await orchestrate({
        repoRoot,
        registry: reg(adapterReturning(reference)),
        correspondences: [corr],
        candidate: () => candidate,
        direction: "code-led",
        outDir,
      });
      const r0 = report.results[0]!;
      // The diff engine exposed a standalone heatmap for the (same-size) pair…
      expect((r0.triptychs ?? []).some((t) => t.diff !== undefined)).toBe(true);
      // …and it was inlined as the page's Diff panel.
      const html = await readFile(r0.reportPath!, "utf8");
      expect(html).toContain('data-role="diff" src="data:image/png;base64,');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("writes no HTML page when no outDir is configured", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "code-led",
    });
    expect(report.results[0]!.reportPath).toBeUndefined();
  });
});

describe("nativeChecks injection (daemon path, #43)", () => {
  it("supersedes the default a11y/i18n checks with the renderer's findings", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      // The renderer supplies one distinctive native a11y finding for this component.
      nativeChecks: (code) =>
        code === corr.code
          ? [{ kind: "a11y", severity: "warn", message: "NATIVE: from the daemon" }]
          : undefined,
      direction: "code-led",
    });
    const verdict = report.results[0]!.verdict!;
    const a11yI18n = verdict.findings.filter(
      (f) => f.kind === "a11y" || f.kind === "i18n" || f.kind === "contrast",
    );
    // a11y/i18n come solely from the injected native provider…
    expect(a11yI18n).toEqual([
      { kind: "a11y", severity: "warn", message: "NATIVE: from the daemon" },
    ]);
    // …while the default checks' contrast finding (present without injection) is gone.
    expect(verdict.findings.some((f) => f.message.includes("WCAG"))).toBe(false);
  });

  it("falls back to the default checks when nativeChecks returns undefined", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      nativeChecks: () => undefined,
      direction: "code-led",
    });
    // The golden candidate trips the default dark-theme contrast check.
    const verdict = report.results[0]!.verdict!;
    expect(verdict.findings.some((f) => f.kind === "contrast")).toBe(true);
  });
});

describe("renderReport", () => {
  it("includes the marker, blocking headline, and component summary", async () => {
    const { reference, candidate } = await load();
    const report = await orchestrate({
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "design-led",
    });
    const md = renderReport(report);
    expect(md).toContain("design-parity-report");
    expect(md).toContain("blocking");
    expect(md).toContain("ui/Button.kt#PrimaryButton");
  });

  it("promotes CMP only when the repo is Android-only (cmpCapable === false)", async () => {
    const { reference, candidate } = await load();
    const base = {
      repoRoot,
      registry: reg(adapterReturning(reference)),
      correspondences: [corr],
      candidate: () => candidate,
      direction: "code-led" as const,
    };
    const report = await orchestrate(base);

    // Android-only repo → advisory present, but never blocking/failing.
    report.cmpCapable = false;
    const promoted = renderReport(report);
    expect(promoted).toContain(CMP_PROMOTION);
    expect(promoted).not.toContain("blocking");

    // Already CMP, or unknown (omitted) → no promotion.
    report.cmpCapable = true;
    expect(renderReport(report)).not.toContain(CMP_PROMOTION);
    delete report.cmpCapable;
    expect(renderReport(report)).not.toContain(CMP_PROMOTION);
  });
});

describe("renderBootstrapNotice", () => {
  it("carries the report marker so it updates in place / is replaced by a verdict", () => {
    const md = renderBootstrapNotice();
    expect(md).toContain(REPORT_MARKER);
  });

  it("points at the interactive bootstrap and never blocks", () => {
    const md = renderBootstrapNotice();
    expect(md).toContain("design-parity-bootstrap");
    expect(md).toContain("#11");
    expect(md).toContain("no PR is blocked");
    // It is a setup pointer, not a verdict — never claims a parity failure.
    expect(md).not.toContain("blocking");
  });
});
