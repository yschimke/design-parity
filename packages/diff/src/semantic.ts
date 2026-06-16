/**
 * Semantic diff: structural / theme deltas between reference and candidate.
 *
 * A {@link DesignReference} carries images + tokens but no semantic tree, so the
 * deltas we can assert deterministically are coverage-shaped: does the candidate
 * render every theme the reference exposes, and does its tree expose accessible
 * content at all (any roled node, any labelled node — the minimum an a11y tree
 * needs)? We check the whole tree, not the root node: a screen's root is a
 * layout container that legitimately carries no role/label of its own, with the
 * real semantics on its descendants. Deeper a11y lives in the checks provider
 * (issue #10).
 */
import type {
  CandidateRender,
  DesignReference,
  Finding,
  SemanticNode,
  Theme,
} from "@design-parity/core";

/** Themes the reference exposes, in first-seen order. */
export function referenceThemes(reference: DesignReference): Theme[] {
  return uniqueThemes(reference.referenceImages.map((i) => i.theme));
}

/** Themes the candidate renders, in first-seen order. */
export function candidateThemes(candidate: CandidateRender): Theme[] {
  return uniqueThemes(candidate.images.map((i) => i.theme));
}

function uniqueThemes(themes: Array<Theme | undefined>): Theme[] {
  const out: Theme[] = [];
  for (const t of themes) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Whether any node in the subtree satisfies `pred`. */
function someNode(node: SemanticNode, pred: (n: SemanticNode) => boolean): boolean {
  if (pred(node)) return true;
  return (node.children ?? []).some((child) => someNode(child, pred));
}

export function diffSemantics(
  reference: DesignReference,
  candidate: CandidateRender,
): Finding[] {
  const findings: Finding[] = [];

  const have = candidateThemes(candidate);
  for (const theme of referenceThemes(reference)) {
    if (!have.includes(theme)) {
      findings.push({
        kind: "semantic",
        severity: "warn",
        message: `reference exposes a ${theme} theme the candidate does not render`,
        detail: { theme, missing: "candidate-image" },
      });
    }
  }

  // Coverage, tree-wide: a candidate that produced no roles / no labels anywhere
  // is missing its a11y tree. The root itself is a layout container and is
  // expected to carry neither — assert on the subtree, not the root node.
  const root = candidate.semantics.root;
  if (!someNode(root, (n) => !!n.role)) {
    findings.push({
      kind: "semantic",
      severity: "warn",
      message: "candidate exposes no accessibility roles",
      detail: { node: "tree", field: "role" },
    });
  }
  if (!someNode(root, (n) => !!n.label)) {
    findings.push({
      kind: "semantic",
      severity: "warn",
      message: "candidate exposes no accessible labels",
      detail: { node: "tree", field: "label" },
    });
  }

  return findings;
}
