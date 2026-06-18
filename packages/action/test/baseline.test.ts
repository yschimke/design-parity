import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  baselineSummary,
  renderBaselineIndex,
  writeBaselineArtifacts,
  validateVerdict,
  VERDICT_FORMAT_VERSION,
  type ParityReport,
} from "../src/index.js";

const report = (outDir: string): ParityReport => ({
  status: "warn",
  blocked: false,
  direction: "code-led",
  warnings: ["unresolved (no source matched): ui/Stale.kt#Gone"],
  results: [
    {
      code: "ui/Button.kt#PrimaryButton",
      source: "figma",
      status: "ok",
      verdict: {
        componentId: "ui/Button.kt#PrimaryButton",
        status: "pass",
        findings: [],
      },
      reportPath: join(outDir, "ui-Button-kt-PrimaryButton", "report.html"),
    },
    {
      code: "ui/Card.kt#Hero",
      source: "figma",
      status: "ok",
      verdict: {
        componentId: "ui/Card.kt#Hero",
        status: "warn",
        findings: [{ severity: "warn", message: "x" } as never],
      },
      reportPath: join(outDir, "ui-Card-kt-Hero", "report.html"),
    },
    {
      code: "ui/Lost.kt#Missing",
      source: "figma",
      status: "skipped",
      note: "no candidate render available",
    },
  ],
});

describe("baselineSummary", () => {
  it("maps verdicts, relative report paths, and findings counts", () => {
    const outDir = "/tmp/out";
    const s = baselineSummary(report(outDir), outDir, {
      commit: "abcdef1234567890",
      now: new Date("2026-06-13T00:00:00Z"),
    });

    expect(s.formatVersion).toBe(VERDICT_FORMAT_VERSION);
    expect(s.$schema).toContain("verdict.schema.json");
    expect(s.status).toBe("warn");
    expect(s.direction).toBe("code-led");
    expect(s.commit).toBe("abcdef1234567890");
    expect(s.generatedAt).toBe("2026-06-13T00:00:00.000Z");
    expect(s.warnings).toHaveLength(1);

    expect(s.components[0]).toMatchObject({
      code: "ui/Button.kt#PrimaryButton",
      verdict: "pass",
      findings: 0,
      report: join("ui-Button-kt-PrimaryButton", "report.html"),
    });
    expect(s.components[1]).toMatchObject({ verdict: "warn", findings: 1 });
    // Skipped components carry no verdict/report but keep their note.
    expect(s.components[2]).toMatchObject({
      status: "skipped",
      note: "no candidate render available",
    });
    expect(s.components[2].verdict).toBeUndefined();
    expect(s.components[2].report).toBeUndefined();
  });
});

describe("renderBaselineIndex", () => {
  it("renders a headline, component links, and warnings", () => {
    const outDir = "/tmp/out";
    const html = renderBaselineIndex(baselineSummary(report(outDir), outDir));
    expect(html).toContain("Parity warn (code-led)");
    expect(html).toContain(
      `href="${join("ui-Button-kt-PrimaryButton", "report.html")}"`,
    );
    expect(html).toContain("ui/Card.kt#Hero");
    expect(html).toContain("1 warning(s)");
  });

  it("escapes component names", () => {
    const html = renderBaselineIndex({
      formatVersion: VERDICT_FORMAT_VERSION,
      generatedAt: "now",
      direction: "code-led",
      status: "pass",
      blocked: false,
      warnings: [],
      components: [{ code: "ui/<x>.kt#A&B", status: "ok" }],
    });
    expect(html).toContain("ui/&lt;x&gt;.kt#A&amp;B");
    expect(html).not.toContain("<x>.kt");
  });
});

describe("writeBaselineArtifacts", () => {
  it("writes index.html + verdict.json into the out dir", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "baseline-test-"));
    try {
      const { indexPath, verdictPath, summary } = await writeBaselineArtifacts(
        outDir,
        report(outDir),
        { commit: "deadbeef" },
      );
      expect(indexPath).toBe("index.html");
      expect(verdictPath).toBe("verdict.json");

      const verdict = JSON.parse(
        await readFile(join(outDir, "verdict.json"), "utf8"),
      );
      expect(verdict.commit).toBe("deadbeef");
      expect(verdict.components).toHaveLength(3);
      expect(summary.status).toBe("warn");

      const index = await readFile(join(outDir, "index.html"), "utf8");
      expect(index).toContain("<!doctype html>");
      expect(index).toContain("Parity warn");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe("validateVerdict", () => {
  it("accepts a freshly assembled summary", () => {
    const summary = baselineSummary(report("/tmp/out"), "/tmp/out", {
      commit: "abcdef1234567890",
      now: new Date("2026-06-14T00:00:00Z"),
    });
    expect(validateVerdict(summary)).toEqual({ valid: true, errors: [] });
  });

  it("accepts the committed verdict.json fixture", async () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/verdict.json", import.meta.url),
    );
    const parsed = JSON.parse(await readFile(fixture, "utf8"));
    const result = validateVerdict(parsed);
    expect(result).toEqual({ valid: true, errors: [] });
    expect(parsed.formatVersion).toBe(VERDICT_FORMAT_VERSION);
  });

  it("rejects a document missing formatVersion", () => {
    const summary = baselineSummary(report("/tmp/out"), "/tmp/out") as Record<
      string,
      unknown
    >;
    delete summary.formatVersion;
    const result = validateVerdict(summary);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("formatVersion");
  });

  it("rejects an unknown verdict status", () => {
    const summary = baselineSummary(report("/tmp/out"), "/tmp/out");
    summary.status = "bogus" as never;
    expect(validateVerdict(summary).valid).toBe(false);
  });
});
