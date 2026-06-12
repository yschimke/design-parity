/**
 * Token collection + token-compliance diff.
 *
 * A {@link DesignReference} carries one flat {@link DesignTokens} bag; a
 * {@link CandidateRender} scatters tokens across its semantic tree. We flatten
 * the candidate's tree into the same shape, then compare key-by-key against the
 * reference spec. Numeric tokens honour a committed tolerance; colours and
 * typography must match exactly.
 */
import type {
  DesignTokens,
  Finding,
  SemanticNode,
  TypographyToken,
} from "@design-parity/core";

import type { DiffConfig } from "./config.js";

/** Deep-merge every node's tokens into one flat bag (children override parents). */
export function collectTokens(root: SemanticNode): DesignTokens {
  const out: DesignTokens = {};
  const visit = (node: SemanticNode): void => {
    mergeInto(out, node.tokens);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

function mergeInto(target: DesignTokens, src?: DesignTokens): void {
  if (!src) return;
  if (src.spacing) target.spacing = { ...target.spacing, ...src.spacing };
  if (src.radius) target.radius = { ...target.radius, ...src.radius };
  if (src.colors) target.colors = { ...target.colors, ...src.colors };
  if (src.typography)
    target.typography = { ...target.typography, ...src.typography };
}

function typographyEqual(a: TypographyToken, b: TypographyToken): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing
  );
}

/**
 * Compare candidate tokens against the reference spec. Findings are emitted in
 * a stable order — spacing, radius, colours, typography — so the verdict is
 * reproducible. A reference token absent from the candidate is a `missing`
 * finding; tokens the candidate adds beyond the spec are ignored.
 */
export function diffTokens(
  spec: DesignTokens | undefined,
  candidate: DesignTokens,
  config: DiffConfig,
): Finding[] {
  const findings: Finding[] = [];
  if (!spec) return findings;

  for (const [name, want] of Object.entries(spec.spacing ?? {})) {
    const got = candidate.spacing?.[name];
    numericFinding("spacing", name, want, got, config.spacingTolerance, findings);
  }
  for (const [name, want] of Object.entries(spec.radius ?? {})) {
    const got = candidate.radius?.[name];
    numericFinding("radius", name, want, got, config.radiusTolerance, findings);
  }
  for (const [name, want] of Object.entries(spec.colors ?? {})) {
    const got = candidate.colors?.[name];
    if (got === undefined) {
      findings.push(missing("colors", name, want));
    } else if (got.toLowerCase() !== want.toLowerCase()) {
      findings.push({
        kind: "token",
        severity: "warn",
        message: `colors.${name}: ${got} vs spec ${want}`,
        detail: { token: `colors.${name}`, expected: want, actual: got },
      });
    }
  }
  for (const [name, want] of Object.entries(spec.typography ?? {})) {
    const got = candidate.typography?.[name];
    if (got === undefined) {
      findings.push(missing("typography", name, JSON.stringify(want)));
    } else if (!typographyEqual(want, got)) {
      findings.push({
        kind: "token",
        severity: "warn",
        message: `typography.${name} differs from spec`,
        detail: { token: `typography.${name}`, expected: want, actual: got },
      });
    }
  }
  return findings;
}

function numericFinding(
  group: "spacing" | "radius",
  name: string,
  want: number,
  got: number | undefined,
  tolerance: number,
  findings: Finding[],
): void {
  if (got === undefined) {
    findings.push(missing(group, name, String(want)));
    return;
  }
  const delta = Math.abs(got - want);
  if (delta > tolerance) {
    findings.push({
      kind: "token",
      severity: "error",
      message: `${group}.${name}: ${got} vs spec ${want} (Δ${delta})`,
      detail: { token: `${group}.${name}`, expected: want, actual: got, delta },
    });
  }
}

function missing(group: string, name: string, want: string): Finding {
  return {
    kind: "token",
    severity: "error",
    message: `${group}.${name} missing from candidate (spec ${want})`,
    detail: { token: `${group}.${name}`, expected: want, actual: null },
  };
}
