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

  it("flags an absent token: numeric is a hard error, unmappable colour is advisory (#102)", () => {
    const findings = diffTokens(spec, { spacing: { padding: 16 } }, defaultDiffConfig);
    // radius.corner (numeric) stays strict → error; colors.label maps to no
    // Material role and didn't value-match → non-blocking advisory.
    expect(findings).toHaveLength(2);
    const radius = findings.find((f) => f.detail?.token === "radius.corner");
    const label = findings.find((f) => f.detail?.token === "colors.label");
    expect(radius).toMatchObject({ severity: "error" });
    expect(label).toMatchObject({ severity: "info", detail: { unmapped: true } });
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

    it("falls back to the Material role heuristic when no alias is supplied (issue #87)", () => {
      // `color/on-surface` denotes the Material role `onSurface`; with values in
      // agreement the heuristic satisfies the spec without an explicit alias.
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#161d1b" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });
  });

  describe("Material role heuristic (issue #87)", () => {
    it("matches a design-vocabulary colour to the candidate's resolved role", () => {
      const designSpec: DesignTokens = {
        colors: { "color/on-surface-variant": "#44483E" },
      };
      const candidate: DesignTokens = { colors: { onSurfaceVariant: "#44483e" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });

    it("flags a role-mapped colour mismatch as a low-confidence warning", () => {
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { onSurface: "#101413" } };
      const findings = diffTokens(designSpec, candidate, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "warn",
        detail: { token: "colors.color/on-surface", role: "onSurface", via: "role-heuristic" },
      });
    });

    it("matches a design-vocabulary typography token to its Material type role", () => {
      const designSpec: DesignTokens = {
        typography: { "type/body/large": { fontSize: 16 } },
      };
      const candidate: DesignTokens = { typography: { bodyLarge: { fontSize: 16 } } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig)).toEqual([]);
    });

    it("reports a colour that maps to no Material role as advisory, not missing (#102)", () => {
      // `label` is not a colour role; with no value match it's unverifiable, so
      // a non-blocking advisory rather than a false `missing` error.
      const designSpec: DesignTokens = { colors: { label: "#FFFFFF" } };
      const findings = diffTokens(designSpec, {}, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { token: "colors.label", unmapped: true },
      });
    });

    it("keeps a role-mapped colour the candidate lacks as a hard error (#102)", () => {
      // `onSurface` IS a Material role; the candidate genuinely lacking it is a
      // real gap, not an unmappable one.
      const designSpec: DesignTokens = { colors: { onSurface: "#161D1B" } };
      const findings = diffTokens(designSpec, {}, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "error", detail: { actual: null } });
    });

    it("reports an unmappable typography token as advisory (#102)", () => {
      const designSpec: DesignTokens = { typography: { caption: { fontSize: 12 } } };
      const findings = diffTokens(designSpec, {}, defaultDiffConfig);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: "info",
        detail: { token: "typography.caption", unmapped: true },
      });
    });

    it("lets an explicit alias override the heuristic", () => {
      // The alias renames the spec to a non-role code name the candidate carries;
      // the heuristic (which would map to `onSurface`) is never consulted.
      const designSpec: DesignTokens = { colors: { "color/on-surface": "#161D1B" } };
      const candidate: DesignTokens = { colors: { brandFg: "#161d1b" } };
      const alias = { colors: { brandFg: "color/on-surface" } };
      expect(diffTokens(designSpec, candidate, defaultDiffConfig, alias)).toEqual([]);
    });
  });
});
