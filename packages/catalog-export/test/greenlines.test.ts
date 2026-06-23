import { describe, expect, it } from "vitest";

import type { Finding, SemanticTree } from "@design-parity/core";

import {
  buildGreenlines,
  findingToGreenline,
  findingsToGreenlines,
  specGreenlines,
} from "../src/greenlines.js";

describe("findingToGreenline", () => {
  it("carries kind, severity, message and lifts bounds out of detail", () => {
    const finding: Finding = {
      kind: "a11y",
      severity: "error",
      message: "Touch target 32×32dp belowMinimum",
      detail: { bounds: { x: 1, y: 2, width: 32, height: 32 }, findings: ["belowMinimum"] },
    };
    const g = findingToGreenline(finding);
    expect(g.kind).toBe("a11y");
    expect(g.severity).toBe("error");
    expect(g.bounds).toEqual({ x: 1, y: 2, width: 32, height: 32 });
    expect(g.detail).toEqual(finding.detail);
  });

  it("leaves bounds unset when detail has none or a malformed one", () => {
    expect(findingToGreenline({ kind: "contrast", severity: "warn", message: "x" }).bounds).toBeUndefined();
    expect(
      findingToGreenline({
        kind: "contrast",
        severity: "warn",
        message: "x",
        detail: { bounds: { x: 1, y: 2 } },
      }).bounds,
    ).toBeUndefined();
  });

  it("maps each finding in order", () => {
    const findings: Finding[] = [
      { kind: "contrast", severity: "error", message: "a" },
      { kind: "i18n", severity: "warn", message: "b" },
    ];
    expect(findingsToGreenlines(findings).map((g) => g.message)).toEqual(["a", "b"]);
  });
});

describe("specGreenlines", () => {
  const tree: SemanticTree = {
    root: {
      children: [
        { role: "button", label: "Save", bounds: { x: 0, y: 0, width: 100, height: 48 } },
        { role: "text", label: "heading" },
        {
          children: [
            { role: "switch", bounds: { x: 0, y: 60, width: 52, height: 32 } },
          ],
        },
      ],
    },
  };

  it("emits one info greenline per interactive node, recursing into children", () => {
    const specs = specGreenlines(tree);
    expect(specs).toHaveLength(2);
    expect(specs.every((g) => g.severity === "info")).toBe(true);
    expect(specs.map((g) => g.detail?.["role"])).toEqual(["button", "switch"]);
    expect(specs[0]?.message).toBe('button "Save"');
    expect(specs[0]?.bounds).toEqual({ x: 0, y: 0, width: 100, height: 48 });
  });

  it("ignores non-interactive roles and an undefined tree", () => {
    expect(specGreenlines(undefined)).toEqual([]);
    expect(specGreenlines({ root: { role: "text", label: "hi" } })).toEqual([]);
  });
});

describe("buildGreenlines", () => {
  it("leads with issues then adds non-duplicate specs", () => {
    const findings: Finding[] = [
      {
        kind: "a11y",
        severity: "error",
        message: "Touch target belowMinimum",
        detail: { bounds: { x: 0, y: 0, width: 100, height: 48 } },
      },
    ];
    const tree: SemanticTree = {
      root: {
        children: [
          // same bounds as the issue → must NOT be duplicated as a spec line
          { role: "button", label: "Save", bounds: { x: 0, y: 0, width: 100, height: 48 } },
          // distinct bounds → kept as a spec line
          { role: "tab", bounds: { x: 0, y: 60, width: 80, height: 48 } },
        ],
      },
    };
    const all = buildGreenlines(findings, tree);
    expect(all).toHaveLength(2);
    expect(all[0]?.severity).toBe("error");
    expect(all[1]?.detail?.["role"]).toBe("tab");
  });
});
