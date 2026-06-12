import { describe, it, expect } from "vitest";

import {
  checkHardcodedStrings,
  checkLocaleFormatting,
  checkRtlMirroring,
  checkTextExpansion,
  resolveConfig,
} from "../src/index.js";
import type { CandidateRender } from "@design-parity/core";
import { candidateOf, goldenCandidate, readLocalJson } from "./helpers.js";

const cfg = resolveConfig();

describe("checkTextExpansion", () => {
  it("flags a truncation case in the fixture (acceptance)", () => {
    const chip = readLocalJson<CandidateRender>(
      "fixtures/chip-truncation.candidate.json",
    );
    const findings = checkTextExpansion(chip, cfg);
    expect(findings.length).toBeGreaterThan(0);
    const f = findings[0]!;
    expect(f.kind).toBe("i18n");
    expect(f.severity).toBe("warn");
    expect(f.message).toMatch(/risks truncation/);
    expect(f.detail?.estimatedExpandedWidth).toBeGreaterThan(
      f.detail?.availableWidth as number,
    );
  });

  it("does not flag the golden button — 'Continue' fits its 160dp button", () => {
    expect(checkTextExpansion(goldenCandidate(), cfg)).toEqual([]);
  });
});

describe("checkLocaleFormatting", () => {
  it.each([
    ["$1,234.00", "currency"],
    ["12/06/2026", "date"],
    ["1,234,567", "number"],
  ])("flags %s as hardcoded %s formatting", (label, format) => {
    const c = candidateOf({ role: "text", label });
    const f = checkLocaleFormatting(c, cfg)[0];
    expect(f!.kind).toBe("i18n");
    expect(f!.detail?.format).toBe(format);
  });

  it("ignores a plain word", () => {
    expect(
      checkLocaleFormatting(candidateOf({ role: "text", label: "Continue" }), cfg),
    ).toEqual([]);
  });
});

describe("checkRtlMirroring", () => {
  it("warns on a directional icon", () => {
    const c = candidateOf({ role: "icon", label: "arrow_forward" });
    const f = checkRtlMirroring(c, cfg)[0];
    expect(f!.severity).toBe("warn");
    expect(f!.message).toMatch(/mirror under RTL/);
  });

  it("notes right-to-left text", () => {
    const c = candidateOf({ role: "text", label: "متابعة" });
    const f = checkRtlMirroring(c, cfg)[0];
    expect(f!.severity).toBe("info");
    expect(f!.message).toMatch(/right-to-left/);
  });

  it("ignores a non-directional label", () => {
    expect(
      checkRtlMirroring(candidateOf({ role: "text", label: "Continue" }), cfg),
    ).toEqual([]);
  });
});

describe("checkHardcodedStrings", () => {
  it("is off by default", () => {
    expect(checkHardcodedStrings(goldenCandidate(), cfg)).toEqual([]);
  });

  it("flags literals when opted in", () => {
    const on = resolveConfig({ flagHardcodedStrings: true });
    const findings = checkHardcodedStrings(goldenCandidate(), on);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.kind).toBe("i18n");
  });
});
