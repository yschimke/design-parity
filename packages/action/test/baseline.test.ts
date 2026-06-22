import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  baselineSummary,
  renderBaselineIndex,
  writeBaselineArtifacts,
  designSystemTokens,
  DESIGN_TOKENS_PATH,
  validateVerdict,
  VERDICT_FORMAT_VERSION,
  type ParityReport,
} from "../src/index.js";
import { readDtcgTokens } from "@design-parity/core";

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

/** A two-component report whose candidate + reference each expose theme tokens. */
const tokenedReport = (direction: ParityReport["direction"]): ParityReport => ({
  status: "pass",
  blocked: false,
  direction,
  warnings: [],
  results: [
    {
      code: "ui/Button.kt#Primary",
      source: "claude-design",
      status: "ok",
      reference: {
        componentId: "ui/Button.kt#Primary",
        source: "claude-design",
        linkMethod: "manifest",
        referenceImages: [],
        themeTokens: { colors: { primary: "#DESIGN" }, spacing: { gap: 8 } },
      } as never,
      candidate: {
        componentId: "ui/Button.kt#Primary",
        images: [],
        semantics: {
          root: { children: [] },
          themeTokens: { colors: { primary: "#C0DE11" }, radius: { corner: 12 } },
        },
      } as never,
    },
    // A second component repeats the same theme — the union must not duplicate.
    {
      code: "ui/Card.kt#Hero",
      source: "claude-design",
      status: "ok",
      candidate: {
        componentId: "ui/Card.kt#Hero",
        images: [],
        semantics: {
          root: { children: [] },
          themeTokens: { colors: { primary: "#C0DE11" } },
        },
      } as never,
    },
  ],
});

describe("designSystemTokens", () => {
  it("prefers the candidate's resolved tokens in code-led", () => {
    const t = designSystemTokens(tokenedReport("code-led"));
    expect(t?.colors?.primary).toBe("#C0DE11"); // candidate wins
    expect(t?.radius?.corner).toBe(12); // candidate-only
    expect(t?.spacing?.gap).toBe(8); // filled from the reference
  });

  it("prefers the reference's tokens in design-led", () => {
    const t = designSystemTokens(tokenedReport("design-led"));
    expect(t?.colors?.primary).toBe("#DESIGN"); // reference wins
    expect(t?.radius?.corner).toBe(12); // still merged in from the candidate
  });

  it("returns undefined when no source exposed tokens", () => {
    expect(designSystemTokens(report("/tmp/out"))).toBeUndefined();
  });
});

describe("writeBaselineArtifacts — design-system tokens", () => {
  it("writes a DTCG token file, links it, and records its path", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "baseline-tokens-"));
    try {
      const { tokensPath, summary } = await writeBaselineArtifacts(
        outDir,
        tokenedReport("code-led"),
      );
      expect(tokensPath).toBe(DESIGN_TOKENS_PATH);
      expect(summary.tokens).toBe(DESIGN_TOKENS_PATH);

      const raw = await readFile(join(outDir, DESIGN_TOKENS_PATH), "utf8");
      const { tokens: back } = readDtcgTokens(JSON.parse(raw));
      expect(back.colors?.["color/primary"]).toBe("#C0DE11");
      expect(back.radius?.["radius/corner"]).toBe(12);

      const index = await readFile(join(outDir, "index.html"), "utf8");
      expect(index).toContain(`href="${DESIGN_TOKENS_PATH}"`);
      expect(index).toContain("DTCG tokens");

      const verdict = JSON.parse(await readFile(join(outDir, "verdict.json"), "utf8"));
      expect(verdict.tokens).toBe(DESIGN_TOKENS_PATH);
      expect(validateVerdict(verdict)).toEqual({ valid: true, errors: [] });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("omits the token file when the run exposed none", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "baseline-notokens-"));
    try {
      const { tokensPath, summary } = await writeBaselineArtifacts(outDir, report(outDir));
      expect(tokensPath).toBeUndefined();
      expect(summary.tokens).toBeUndefined();
      await expect(readFile(join(outDir, DESIGN_TOKENS_PATH), "utf8")).rejects.toThrow();
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
