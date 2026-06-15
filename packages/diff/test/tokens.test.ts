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
});
