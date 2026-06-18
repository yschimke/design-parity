import { describe, it, expect } from "vitest";

import type { DesignTokens } from "@design-parity/core";

import { diffDesignSystem } from "../src/design-system.js";

describe("diffDesignSystem", () => {
  it("is empty when either table (or its colours) is absent", () => {
    const t: DesignTokens = { colors: { onSurface: "#000000" } };
    expect(diffDesignSystem(undefined, t)).toEqual([]);
    expect(diffDesignSystem(t, undefined)).toEqual([]);
    expect(diffDesignSystem({ radius: { card: 8 } }, t)).toEqual([]);
  });

  it("flags palette drift via alias + render theme, against a single-mode code theme", () => {
    const design: DesignTokens = {
      colors: { "on-surface.light": "#161D1B", "on-surface.dark": "#E0E3E0" },
    };
    const code: DesignTokens = { colors: { onSurface: "#101413" } };
    const findings = diffDesignSystem(design, code, {
      theme: "light",
      alias: { colors: { onSurface: "on-surface" } },
    });
    // Only the light entry lines up with the resolved (light) code theme.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "token",
      severity: "warn",
      detail: {
        scope: "design-system",
        token: "colors.onSurface",
        mode: "light",
        expected: "#161D1B",
        actual: "#101413",
      },
    });
  });

  it("compares every mode when the code table is itself mode-suffixed", () => {
    const design: DesignTokens = {
      colors: { "container.light": "#645AFF", "container.dark": "#8A82FF" },
    };
    const code: DesignTokens = {
      colors: { "container.light": "#645AFF", "container.dark": "#7A72F0" },
    };
    const findings = diffDesignSystem(design, code); // no theme filter needed
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toMatchObject({
      token: "colors.container",
      mode: "dark",
      expected: "#8A82FF",
      actual: "#7A72F0",
    });
  });

  it("treats a full-alpha suffix as equal (no finding)", () => {
    const design: DesignTokens = { colors: { onSurface: "#161D1B" } };
    const code: DesignTokens = { colors: { onSurface: "#161d1bff" } };
    expect(diffDesignSystem(design, code)).toEqual([]);
  });

  it("emits nothing when the palettes agree", () => {
    const t: DesignTokens = { colors: { onSurface: "#161D1B" } };
    expect(diffDesignSystem(t, t)).toEqual([]);
  });

  it("flags radius drift, mapping a shape-scale name to its Material role within tolerance", () => {
    const design: DesignTokens = { radius: { "radius/medium": 12 } };
    const code: DesignTokens = { radius: { medium: 8 } };
    const findings = diffDesignSystem(design, code, { radiusTolerance: 1 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warn",
      detail: {
        scope: "design-system",
        token: "radius.medium",
        expected: 12,
        actual: 8,
        delta: 4,
      },
    });
  });

  it("keeps a radius within tolerance quiet", () => {
    const design: DesignTokens = { radius: { "radius/medium": 8.4 } };
    const code: DesignTokens = { radius: { medium: 8 } };
    expect(diffDesignSystem(design, code, { radiusTolerance: 1 })).toEqual([]);
  });

  it("skips a design token the code theme doesn't carry (spacing, v1)", () => {
    const design: DesignTokens = { spacing: { "space/large": 24 } };
    const code: DesignTokens = { radius: { medium: 8 } };
    expect(diffDesignSystem(design, code)).toEqual([]);
  });

  it("flags type-ramp drift, mapping a style name to its Material type role", () => {
    const design: DesignTokens = {
      typography: { "body/large": { fontSize: 16, fontWeight: 500 } },
    };
    const code: DesignTokens = {
      // bodyLarge resolves more than the design declares (fontStyle) — not drift —
      // but the weight differs, which is.
      typography: { bodyLarge: { fontSize: 16, fontWeight: 400, fontStyle: "normal" } },
    };
    const findings = diffDesignSystem(design, code);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warn",
      message: "design-system typography.bodyLarge differs from design",
      detail: { scope: "design-system", token: "typography.bodyLarge" },
    });
  });

  it("treats a spec-satisfying type style as no drift (candidate may resolve more)", () => {
    const design: DesignTokens = {
      typography: { "body/large": { fontSize: 16, fontWeight: 400 } },
    };
    const code: DesignTokens = {
      typography: { bodyLarge: { fontSize: 16, fontWeight: 400, fontStyle: "normal", lineHeight: 24 } },
    };
    expect(diffDesignSystem(design, code)).toEqual([]);
  });

  it("honours an explicit typography alias over the role heuristic", () => {
    const design: DesignTokens = { typography: { "Brand/Hero": { fontSize: 40 } } };
    const code: DesignTokens = { typography: { displayLarge: { fontSize: 36 } } };
    const findings = diffDesignSystem(design, code, {
      alias: { typography: { displayLarge: "Brand/Hero" } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toMatchObject({ token: "typography.displayLarge" });
  });
});
