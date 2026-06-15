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
});
