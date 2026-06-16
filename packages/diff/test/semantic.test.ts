import { describe, it, expect } from "vitest";

import type {
  CandidateRender,
  DesignReference,
  SemanticNode,
} from "@design-parity/core";

import { diffSemantics } from "../src/semantic.js";

/** A candidate whose semantic tree has the given root; one untyped image. */
function candidateWith(root: SemanticNode): CandidateRender {
  return {
    images: [{ theme: undefined }],
    semantics: { root },
  } as unknown as CandidateRender;
}

const reference = {
  referenceImages: [{ theme: undefined }],
} as unknown as DesignReference;

describe("diffSemantics a11y coverage", () => {
  it("does not flag a container root whose descendants carry roles + labels", () => {
    // A screen root is a layout container with no role/label of its own; the
    // real semantics live on its children. That is healthy, not a finding.
    const root: SemanticNode = {
      children: [
        { role: "button", label: "Send" },
        { children: [{ role: "image", label: "Avatar" }] },
      ],
    };
    expect(diffSemantics(reference, candidateWith(root))).toEqual([]);
  });

  it("flags a tree that exposes no roles and no labels anywhere", () => {
    const root: SemanticNode = { children: [{ children: [{}] }] };
    const findings = diffSemantics(reference, candidateWith(root));
    expect(findings.map((f) => f.message)).toEqual([
      "candidate exposes no accessibility roles",
      "candidate exposes no accessible labels",
    ]);
  });

  it("flags only labels when the tree has a role but no label", () => {
    const root: SemanticNode = { children: [{ role: "button" }] };
    const findings = diffSemantics(reference, candidateWith(root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      message: "candidate exposes no accessible labels",
      detail: { field: "label" },
    });
  });
});
