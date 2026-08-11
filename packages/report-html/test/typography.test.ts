import { describe, expect, it } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import {
  clusterTypography,
  compareTypography,
  normalizeFontFamily,
  normalizeTypographyToken,
  typographyGroups,
} from "../src/typography.js";

function tree(token: string, family: string, labels: readonly [string, number, number][]): SemanticTree {
  return {
    root: {
      role: "group",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      children: labels.map(([label, x, y]) => ({
        role: "text",
        label,
        bounds: { x, y, width: 48, height: 20 },
        tokens: {
          typography: {
            [token]: { fontFamily: family, fontSize: 14, fontWeight: 500, lineHeight: 20 },
          },
        },
      })),
    },
  };
}

describe("typography grouping", () => {
  it("normalizes Material role spelling and weight-suffixed family names", () => {
    expect(normalizeTypographyToken("m3/label/large")).toBe("labelLarge");
    expect(normalizeFontFamily("Roboto-Medium")).toBe("Roboto");
  });

  it("groups repeated styles and clusters only adjacent uses", () => {
    const groups = typographyGroups(
      tree("labelLarge", "Roboto", [
        ["One", 10, 10],
        ["Two", 100, 10],
        ["Far away", 10, 240],
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.nodes).toHaveLength(3);
    expect(clusterTypography(groups[0]!)).toEqual([
      { x: 10, y: 10, width: 138, height: 20 },
      { x: 10, y: 240, width: 48, height: 20 },
    ]);
  });

  it("pairs differently named reference and candidate styles by their shared usages", () => {
    const comparison = compareTypography(
      tree("m3/label/large", "Roboto", [
        ["Label", 10, 10],
        ["Secondary", 100, 10],
      ]),
      tree("bodyMedium", "Roboto-Medium", [
        ["Label", 10, 10],
        ["Secondary", 100, 10],
      ]),
    );
    expect(comparison.pairs).toHaveLength(1);
    expect(comparison.pairs[0]?.marker).toBe("A");
    expect(comparison.pairs[0]?.reference?.token).toBe("labelLarge");
    expect(comparison.pairs[0]?.candidate?.token).toBe("bodyMedium");
    expect(comparison.referenceMarkers.get(comparison.pairs[0]!.reference!.key)).toBe("A");
    expect(comparison.candidateMarkers.get(comparison.pairs[0]!.candidate!.key)).toBe("A");
  });
});
