import { describe, expect, it } from "vitest";

import type { Finding, SemanticTree, Verdict } from "@design-parity/core";

import {
  PARITY_FINDINGS_SCHEMA,
  buildParityFindingSet,
  buildParityFindingsManifest,
  findingAnchors,
  isEmptyParityFindings,
  toParityFinding,
} from "../src/parityFindings.js";

const candidate: SemanticTree = {
  root: {
    role: "Button",
    bounds: { x: 0, y: 0, width: 200, height: 80 },
    children: [
      { role: "Text", label: "Send", bounds: { x: 20, y: 26, width: 128, height: 20 } },
      { role: "Icon", label: "chevron", bounds: { x: 160, y: 30, width: 12, height: 12 } },
    ],
  },
} as SemanticTree;

const reference: SemanticTree = {
  root: {
    role: "Button",
    bounds: { x: 0, y: 0, width: 172, height: 64 },
    children: [{ role: "Text", label: " send ", bounds: { x: 12, y: 20, width: 100, height: 18 } }],
  },
} as SemanticTree;

function finding(overrides: Partial<Finding> = {}): Finding {
  return { kind: "layout", severity: "warn", message: "m", ...overrides } as Finding;
}

describe("findingAnchors", () => {
  it("uses a box the check measured, on the side the check ran over", () => {
    const anchors = findingAnchors(
      finding({ kind: "a11y", detail: { role: "Button", bounds: { x: 4, y: 6, width: 40, height: 30 } } }),
      { candidate, reference },
    );
    expect(anchors).toEqual([{ side: "actual", bounds: { x: 4, y: 6, width: 40, height: 30 } }]);
  });

  it("resolves a labelled finding on both panels, each in its own pixel space", () => {
    const anchors = findingAnchors(
      finding({ detail: { label: "Send", dx: 1, dy: -12, dw: 41, dh: 3 } }),
      { candidate, reference },
    );
    expect(anchors).toEqual([
      { side: "reference", bounds: { x: 12, y: 20, width: 100, height: 18 }, label: "Send" },
      { side: "actual", bounds: { x: 20, y: 26, width: 128, height: 20 }, label: "Send" },
    ]);
  });

  it("anchors on one panel when only one has the element", () => {
    const anchors = findingAnchors(finding({ detail: { label: "chevron" } }), {
      candidate,
      reference,
    });
    expect(anchors.map((a) => a.side)).toEqual(["actual"]);
  });

  it("anchors a token finding to each component's own frame, which is what it claims about", () => {
    const anchors = findingAnchors(
      finding({ kind: "token", detail: { token: "spacing.padding", expected: 16, actual: 24 } }),
      { candidate, reference },
    );
    expect(anchors).toEqual([
      { side: "reference", bounds: { x: 0, y: 0, width: 172, height: 64 } },
      { side: "actual", bounds: { x: 0, y: 0, width: 200, height: 80 } },
    ]);
  });

  it("gives a finding it cannot place no anchor rather than a plausible one", () => {
    expect(findingAnchors(finding({ kind: "visual", detail: { key: "default" } }), { candidate })).toEqual(
      [],
    );
    // A label nothing in either tree carries is the same case: pointing at the nearest element
    // would be a claim about the wrong node, which a reader has no way to check.
    expect(findingAnchors(finding({ detail: { label: "nowhere" } }), { candidate, reference })).toEqual(
      [],
    );
  });

  it("drops a box with no area", () => {
    expect(
      findingAnchors(finding({ detail: { bounds: { x: 0, y: 0, width: 0, height: 8 } } }), {}),
    ).toEqual([]);
  });
});

describe("toParityFinding", () => {
  it("flattens detail to the strings the wire type carries", () => {
    const projected = toParityFinding(
      finding({
        kind: "token",
        severity: "error",
        message: "spacing.padding: 24 vs spec 16",
        detail: { token: "spacing.padding", expected: 16, actual: 24, unverified: false },
      }),
    );
    expect(projected.detail).toEqual({
      token: "spacing.padding",
      expected: "16",
      actual: "24",
      unverified: "false",
    });
  });

  it("keeps bounds out of the readout — it is geometry, not a sentence", () => {
    const projected = toParityFinding(
      finding({ kind: "a11y", detail: { role: "Button", bounds: { x: 1, y: 2, width: 8, height: 8 } } }),
      { candidate },
    );
    expect(projected.detail).toEqual({ role: "Button" });
    expect(projected.anchors).toHaveLength(1);
  });
});

describe("buildParityFindingsManifest", () => {
  const verdict = (findings: Finding[], status: Verdict["status"] = "fail"): Verdict =>
    ({ componentId: "Button/Filled", status, findings }) as Verdict;

  it("keys every id the compare page may route on", () => {
    const manifest = buildParityFindingsManifest([
      {
        previewIds: ["button-filled__ideal__default__light", "com.example.ButtonPreview"],
        referenceId: "design-button",
        verdict: verdict([finding({ detail: { label: "Send" } })]),
        candidate,
        reference,
      },
    ]);
    expect(manifest.schema).toBe(PARITY_FINDINGS_SCHEMA);
    expect(Object.keys(manifest.previews).sort()).toEqual([
      "button-filled__ideal__default__light",
      "com.example.ButtonPreview",
    ]);
    expect(manifest.previews["com.example.ButtonPreview"]?.[0]?.referenceId).toBe("design-button");
  });

  it("carries the run's own status rather than re-deriving one", () => {
    // A run that accepted a known difference concluded `pass` over a finding it still reports.
    const manifest = buildParityFindingsManifest([
      {
        previewIds: ["p"],
        verdict: verdict([finding({ severity: "error" })], "pass"),
        candidate,
      },
    ]);
    expect(manifest.previews["p"]?.[0]?.status).toBe("pass");
  });

  it("omits a clean verdict, so a passing component grows no empty panel", () => {
    const manifest = buildParityFindingsManifest([
      { previewIds: ["p"], verdict: verdict([], "pass") },
    ]);
    expect(isEmptyParityFindings(manifest)).toBe(true);
  });

  it("collects several references for one preview as separate sets", () => {
    const manifest = buildParityFindingsManifest([
      { previewIds: ["p"], referenceId: "a", verdict: verdict([finding()]) },
      { previewIds: ["p"], referenceId: "b", verdict: verdict([finding()]) },
    ]);
    expect(manifest.previews["p"]?.map((set) => set.referenceId)).toEqual(["a", "b"]);
  });
});

describe("buildParityFindingSet", () => {
  it("carries a report link out to the run's own page", () => {
    const set = buildParityFindingSet(
      { componentId: "c", status: "warn", findings: [finding()] } as Verdict,
      { reportUrl: "https://example.test/report.html" },
    );
    expect(set.reportUrl).toBe("https://example.test/report.html");
  });
});
