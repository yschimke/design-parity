import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

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

const load = async () => ({
  reference: await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  ),
  candidate: await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  ),
});

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
});
