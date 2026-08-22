import { describe, expect, it } from "vitest";

import type { SemanticTree } from "@design-parity/core";

import {
  clusterTypography,
  compareTypography,
  normalizeFontFamily,
  normalizeTypographyToken,
  typographyDefaults,
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

  it("measures its gaps in the boxes' own space, not the tokens'", () => {
    // The same two uses on a 3× board: boxes tripled, and the line height
    // already normalised to dp by the report's entry. A 20dp line height must
    // still reach 3× further to see them as adjacent.
    const groups = typographyGroups(
      tree("labelLarge", "Roboto", [
        ["One", 30, 30],
        ["Two", 300, 30],
      ]),
    );
    const scaled = {
      ...groups[0]!,
      nodes: groups[0]!.nodes.map((n) => ({
        ...n,
        bounds: { x: n.bounds.x, y: n.bounds.y, width: 144, height: 60 },
      })),
    };
    // Guard the guard: at 1× these boxes are far enough apart to split, so the
    // single cluster below is the density doing the work and not the geometry.
    expect(clusterTypography(scaled)).toHaveLength(2);
    expect(clusterTypography(scaled, 3)).toEqual([
      { x: 30, y: 30, width: 414, height: 60 },
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

  it("uses the most common resolved form as a token default and keeps overrides separate", () => {
    const semanticTree = tree("bodyLarge", "Roboto", [
      ["Default one", 10, 10],
      ["Default two", 100, 10],
    ]);
    semanticTree.root.children!.push({
      role: "text",
      label: "Emphasis",
      bounds: { x: 10, y: 50, width: 48, height: 20 },
      tokens: {
        typography: {
          bodyLarge: { fontFamily: "Roboto", fontSize: 14, fontWeight: 700, lineHeight: 20 },
        },
      },
    });
    const groups = typographyGroups(semanticTree);
    expect(groups).toHaveLength(2);
    expect(typographyDefaults(groups).get("bodyLarge")?.nodes).toHaveLength(2);
    expect(groups.find((group) => group.typography.fontWeight === 700)?.nodes).toHaveLength(1);
  });
});
