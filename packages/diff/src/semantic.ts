/**
 * Semantic diff: structural / theme deltas between reference and candidate.
 *
 * A {@link DesignReference} carries images + tokens but no semantic tree, so the
 * deltas we can assert deterministically are coverage-shaped: does the candidate
 * render every theme the reference exposes, and is its root node a labelled,
 * roled element (the minimum an a11y tree needs)? Deeper a11y lives in the
 * checks provider (issue #10).
 */
import type {
  CandidateRender,
  DesignReference,
  Finding,
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

  const root = candidate.semantics.root;
  if (!root.role) {
    findings.push({
      kind: "semantic",
      severity: "warn",
      message: "candidate root node has no accessibility role",
      detail: { node: "root", field: "role" },
    });
  }
  if (!root.label) {
    findings.push({
      kind: "semantic",
      severity: "warn",
      message: "candidate root node has no accessible label",
      detail: { node: "root", field: "label" },
    });
  }

  return findings;
}
