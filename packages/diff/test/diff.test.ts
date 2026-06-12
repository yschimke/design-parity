import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import type { CandidateRender, DesignReference } from "@design-parity/core";

import { diff } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repoRoot, p), "utf8")) as T;
}

const loadPair = async () => ({
  reference: await readJson<DesignReference>(
    "fixtures/figma/button-primary.reference.json",
  ),
  candidate: await readJson<CandidateRender>(
    "fixtures/candidate/button-primary.candidate.json",
  ),
});

describe("diff engine on the figma button fixtures", () => {
  it("fails the verdict and shares the componentId", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    expect(verdict.componentId).toBe("ui/Button.kt#PrimaryButton");
    expect(verdict.status).toBe("fail");
  });

  it("reports the padding token violation (12 vs spec 16)", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const padding = verdict.findings.find(
      (f) => f.kind === "token" && f.detail?.token === "spacing.padding",
    );
    expect(padding).toBeDefined();
    expect(padding!.severity).toBe("error");
    expect(padding!.detail).toMatchObject({ expected: 16, actual: 12, delta: 4 });
  });

  it("reports the dark-theme contrast failure (WCAG AA), via @design-parity/checks", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    // the dark drift is the only AA *failure*; light passes AA (an info note).
    const failures = verdict.findings.filter(
      (f) => f.kind === "contrast" && f.severity === "error",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ theme: "dark", required: 4.5 });
    expect(failures[0]!.detail!.ratio as number).toBeLessThan(4.5);
  });

  it("flags the drifted dark container colour as a token warning", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const color = verdict.findings.find(
      (f) => f.kind === "token" && f.detail?.token === "colors.container.dark",
    );
    expect(color).toBeDefined();
    expect(color!.severity).toBe("warn");
    expect(color!.detail).toMatchObject({
      expected: "#8A82FF",
      actual: "#7A72F0",
    });
  });

  it("scores light theme as identical and dark theme as differing", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    expect(verdict.visualScores?.["default/light/compact"]).toBe(0);
    expect(verdict.visualScores?.["default/dark/compact"]).toBeGreaterThan(0);
  });

  it("leads the findings with a11y, then tokens, then visual", async () => {
    const { reference, candidate } = await loadPair();
    const { verdict } = await diff(reference, candidate, { repoRoot });

    const order = verdict.findings.map((f) => f.kind);
    const firstToken = order.indexOf("token");
    const firstVisual = order.indexOf("visual");
    expect(order[0]).toBe("contrast");
    expect(firstToken).toBeGreaterThan(0);
    expect(firstVisual).toBeGreaterThan(firstToken);
  });

  it("emits a triptych PNG per image pair", async () => {
    const { reference, candidate } = await loadPair();
    const { triptychs } = await diff(reference, candidate, { repoRoot });

    expect(triptychs.map((t) => t.key).sort()).toEqual([
      "default/dark/compact",
      "default/light/compact",
    ]);
    for (const t of triptychs) {
      // PNG magic number.
      expect(t.png.subarray(0, 4).toString("hex")).toBe("89504e47");
    }
  });

  it("is deterministic: same input → byte-identical verdict and triptychs", async () => {
    const { reference, candidate } = await loadPair();
    const a = await diff(reference, candidate, { repoRoot });
    const b = await diff(reference, candidate, { repoRoot });

    expect(JSON.stringify(a.verdict)).toBe(JSON.stringify(b.verdict));
    expect(a.summary).toBe(b.summary);
    for (let i = 0; i < a.triptychs.length; i++) {
      expect(a.triptychs[i]!.png.equals(b.triptychs[i]!.png)).toBe(true);
    }
  });

  it("renders a markdown summary that names the failures", async () => {
    const { reference, candidate } = await loadPair();
    const { summary } = await diff(reference, candidate, { repoRoot });

    expect(summary).toContain("❌ fail");
    expect(summary).toContain("Accessibility & i18n");
    expect(summary).toContain("Token compliance");
    expect(summary).toContain("spacing.padding");
  });
});
