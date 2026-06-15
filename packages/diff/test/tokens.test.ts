import { describe, it, expect } from "vitest";

import type { DesignTokens, SemanticNode } from "@design-parity/core";

import { defaultDiffConfig } from "../src/config.js";
import { collectTokens, diffTokens } from "../src/tokens.js";

describe("collectTokens", () => {
  it("flattens a tree, with children overriding parents", () => {
    const root: SemanticNode = {
      role: "button",
      tokens: {
        spacing: { padding: 12 },
        colors: { container: "#000000" },
      },
      children: [
        {
          role: "text",
          tokens: {
            colors: { label: "#FFFFFF" },
            typography: { label: { fontSize: 14 } },
          },
        },
      ],
    };
    expect(collectTokens(root)).toEqual<DesignTokens>({
      spacing: { padding: 12 },
      colors: { container: "#000000", label: "#FFFFFF" },
      typography: { label: { fontSize: 14 } },
    });
  });
});

describe("diffTokens", () => {
  const spec: DesignTokens = {
    spacing: { padding: 16 },
    radius: { corner: 8 },
    colors: { label: "#FFFFFF" },
  };

  it("is empty when the candidate matches the spec", () => {
    expect(diffTokens(spec, spec, defaultDiffConfig)).toEqual([]);
  });

  it("flags numeric drift beyond tolerance as an error", () => {
    const findings = diffTokens(
      spec,
      { ...spec, spacing: { padding: 12 } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "token", severity: "error" });
  });

  it("respects a configured spacing tolerance", () => {
    const lenient = { ...defaultDiffConfig, spacingTolerance: 4 };
    const findings = diffTokens(
      spec,
      { ...spec, spacing: { padding: 12 } },
      lenient,
    );
    expect(findings).toEqual([]);
  });

  it("flags colour drift as a warning, case-insensitively for matches", () => {
    const matchLower = diffTokens(
      spec,
      { ...spec, colors: { label: "#ffffff" } },
      defaultDiffConfig,
    );
    expect(matchLower).toEqual([]);

    const drift = diffTokens(
      spec,
      { ...spec, colors: { label: "#EEEEEE" } },
      defaultDiffConfig,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ kind: "token", severity: "warn" });
  });

  it("flags a reference token missing from the candidate", () => {
    const findings = diffTokens(spec, { spacing: { padding: 16 } }, defaultDiffConfig);
    // radius.corner and colors.label are both absent.
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("matches a colour that differs only by a full-alpha suffix (issue #74)", () => {
    // `argbToCssHex` emits `#RRGGBBAA`; `#FF161D1B` (ARGB) becomes `#161d1bff`.
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    expect(
      diffTokens(colourSpec, { colors: { onSurface: "#161d1bff" } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("satisfies a named spec colour from a generic role key of the same role (issue #74)", () => {
    // No resolved theme → the value lands under the role key `fg`, not `onSurface`.
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    expect(
      diffTokens(colourSpec, { colors: { fg: "#161d1bff" } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("does not let a background candidate value satisfy a foreground spec token", () => {
    const colourSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
    const findings = diffTokens(
      colourSpec,
      { colors: { bg: "#161d1bff" } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      detail: { token: "colors.onSurface", actual: null },
    });
  });

  it("satisfies a named spec spacing token from a within-tolerance value match (#1897)", () => {
    // The candidate carries resolved padding under generic keys, not the
    // reference's `screenPadding` name — a value match still satisfies the spec.
    const padSpec: DesignTokens = { spacing: { screenPadding: 16 } };
    expect(
      diffTokens(
        padSpec,
        { spacing: { paddingStart: 16, padding: 16 } },
        defaultDiffConfig,
      ),
    ).toEqual([]);
  });

  it("satisfies a named spec radius token from a value match (#1897)", () => {
    const radSpec: DesignTokens = { radius: { card: 12 } };
    expect(
      diffTokens(radSpec, { radius: { corner: 12 } }, defaultDiffConfig),
    ).toEqual([]);
  });

  it("reports a numeric token missing when no candidate value is within tolerance (#1897)", () => {
    const padSpec: DesignTokens = { spacing: { screenPadding: 16 } };
    const findings = diffTokens(
      padSpec,
      { spacing: { padding: 4 } },
      defaultDiffConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      detail: { token: "spacing.screenPadding", actual: null },
    });
  });

  describe("token alias map (issue #78)", () => {
    it("matches a design-named token to its code counterpart across kinds", () => {
      const designSpec: DesignTokens = {
        colors: { "color/on-surface": "#161D1B" },
        typography: { "type/body/large": { fontSize: 16 } },
        spacing: { "space/gutter": 16 },
        radius: { "radius/card": 8 },
      };
      const candidate: DesignTokens = {
        colors: { onSurface: "#161d1b" },
        typography: { bodyLarge: { fontSize: 16 } },
        spacing: { gutter: 16 },
        radius: { card: 8 },
      };
      const alias = {
        colors: { onSurface: "color/on-surface" },
        typography: { bodyLarge: "type/body/large" },
        spacing: { gutter: "space/gutter" },
        radius: { card: "radius/card" },
      };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig, alias)).toEqual([]);
    });

    it("still flags drift after aliasing (value compare is unchanged)", () => {
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#101413" } };
      const alias = { colors: { onSurface: "color/on-surface" } };
      const findings = diffTokens(designSpec, candidate, defaultDiffConfig, alias);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "warn",
        detail: { token: "colors.onSurface" },
      });
    });

    it("leaves behaviour unchanged when no alias is supplied", () => {
      // Without the alias the design name doesn't match the code name → missing.
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#161d1b" } };
      const findings = diffTokens(designSpec, candidate, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "error" });
    });
  });
});
