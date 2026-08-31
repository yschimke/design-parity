import { describe, it, expect } from "vitest";

import { checkContrast, resolveConfig, runChecks } from "../src/index.js";
import { candidateOf, goldenCandidate, goldenFigmaReference } from "./helpers.js";

describe("checkContrast on the golden candidate", () => {
  const findings = checkContrast(goldenCandidate(), resolveConfig());

  it("flags the dark-theme AA failure the fixture encodes", () => {
    const dark = findings.find((f) => f.detail?.theme === "dark");
    expect(dark).toBeDefined();
    expect(dark!.kind).toBe("contrast");
    expect(dark!.severity).toBe("error");
    expect(dark!.detail?.ratio).toBe(3.82);
    expect(dark!.detail?.required).toBe(4.5);
    expect(dark!.message).toMatch(/fails WCAG AA/);
  });

  it("passes AA on the light theme but notes the AAA shortfall", () => {
    const light = findings.find((f) => f.detail?.theme === "light");
    expect(light).toBeDefined();
    expect(light!.severity).toBe("info");
    expect(light!.detail?.ratio).toBe(4.72);
    expect(light!.message).toMatch(/meets AA but not AAA/);
  });

  it("is the same result every run (deterministic)", () => {
    const again = checkContrast(goldenCandidate(), resolveConfig());
    expect(again).toEqual(findings);
  });
});

describe("runChecks ordering", () => {
  it("leads the verdict with the a11y contrast error", () => {
    const all = runChecks(goldenFigmaReference(), goldenCandidate());
    expect(all[0]?.kind).toBe("contrast");
    expect(all[0]?.severity).toBe("error");
  });

  it("keeps an identical reference contrast defect visible but non-blocking", () => {
    const semantics = {
      root: {
        role: "text",
        label: "Outline",
        tokens: {
          colors: { label: "#FEF7FF", container: "#79747E" },
          typography: { label: { fontSize: 11, fontWeight: 500 } },
        },
      },
    } as const;
    const candidate = candidateOf({
      ...semantics.root,
      tokens: {
        ...semantics.root.tokens,
        colors: { label: "#FEF7FFFF", container: "#79747EFF" },
      },
    });
    const reference = { ...goldenFigmaReference(), layout: semantics };

    const finding = runChecks(reference, candidate).find((f) => f.kind === "contrast");
    expect(finding).toMatchObject({
      severity: "warn",
      detail: { sharedWithReference: true },
    });
    expect(finding!.message).toMatch(/shared design debt/);
  });

  it("does not suppress a candidate-only contrast defect", () => {
    const candidate = candidateOf({
      role: "text",
      label: "Outline",
      tokens: {
        colors: { label: "#FEF7FF", container: "#79747E" },
        typography: { label: { fontSize: 11, fontWeight: 500 } },
      },
    });
    const noLayout = goldenFigmaReference();
    delete noLayout.layout;
    const differentPair = {
      ...goldenFigmaReference(),
      layout: {
        root: {
          role: "text",
          tokens: {
            colors: { label: "#777777", container: "#FFFFFF" },
            typography: { label: { fontSize: 11 } },
          },
        },
      },
    };
    const differentAlpha = {
      ...goldenFigmaReference(),
      layout: {
        root: {
          role: "text",
          tokens: {
            colors: { label: "#FEF7FF80", container: "#79747E" },
            typography: { label: { fontSize: 11 } },
          },
        },
      },
    };

    expect(
      runChecks(noLayout, candidate).find((f) => f.kind === "contrast")!.severity,
    ).toBe("error");
    expect(
      runChecks(differentPair, candidate).find((f) => f.kind === "contrast")!.severity,
    ).toBe("error");
    expect(
      runChecks(differentAlpha, candidate).find((f) => f.kind === "contrast")!.severity,
    ).toBe("error");
  });
});

describe("AAA mode", () => {
  it("turns the light-theme AAA shortfall into an error", () => {
    const findings = checkContrast(
      goldenCandidate(),
      resolveConfig({ contrastLevel: "AAA" }),
    );
    const light = findings.find((f) => f.detail?.theme === "light");
    expect(light!.severity).toBe("error");
    expect(light!.detail?.required).toBe(7.0);
  });
});
