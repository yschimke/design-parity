/**
 * Build the accessibility **greenline** layer for a component.
 *
 * Two sources feed it:
 *
 * 1. **Issue greenlines** — the renderer's a11y/contrast/i18n {@link Finding}s
 *    (from `@design-parity/candidate`'s `nativeFindings`, or
 *    `@design-parity/checks`). Each becomes a greenline at the finding's bounds.
 * 2. **Spec greenlines** — `info`-level annotations walked from the
 *    {@link SemanticTree}: every interactive node is annotated with its role and
 *    measured size, so the sheet documents the touch-target contract even when
 *    nothing fails. A node already covered by an issue greenline at the same
 *    bounds is not duplicated.
 *
 * Pure functions over core types — no I/O, trivially testable.
 */
import type {
  Bounds,
  Finding,
  SemanticNode,
  SemanticTree,
} from "@design-parity/core";

import type { Greenline } from "./types.js";

/**
 * Roles that must meet the touch-target contract. Mirrors
 * `@design-parity/checks` `INTERACTIVE_ROLES` (kept inline so this package
 * depends on `core` only).
 */
export const INTERACTIVE_ROLES: readonly string[] = [
  "button",
  "link",
  "switch",
  "checkbox",
  "radio",
  "textfield",
  "menuitem",
  "tab",
  "slider",
];

/** WCAG 2.5.8 / Material minimum touch target, in dp. */
export const MIN_TOUCH_TARGET_DP = 48;

function isBounds(v: unknown): v is Bounds {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.width === "number" &&
    typeof b.height === "number"
  );
}

function sameBounds(a: Bounds | undefined, b: Bounds | undefined): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Map one renderer {@link Finding} to an issue {@link Greenline}. */
export function findingToGreenline(finding: Finding): Greenline {
  const out: Greenline = {
    kind: finding.kind,
    severity: finding.severity,
    message: finding.message,
  };
  const bounds = finding.detail?.["bounds"];
  if (isBounds(bounds)) out.bounds = bounds;
  if (finding.detail) out.detail = finding.detail;
  return out;
}

/** Map a component's findings to issue greenlines, in finding order. */
export function findingsToGreenlines(findings: readonly Finding[]): Greenline[] {
  return findings.map(findingToGreenline);
}

/**
 * Walk a {@link SemanticTree} and emit a spec greenline for every interactive
 * node — its role, and its bounds when known — at `info` severity. These
 * document the touch-target contract; the writer/board renders them in the same
 * green annotation style as the issue greenlines, just non-blocking.
 */
export function specGreenlines(tree: SemanticTree | undefined): Greenline[] {
  if (!tree) return [];
  const out: Greenline[] = [];
  const visit = (node: SemanticNode): void => {
    const role = node.role?.toLowerCase();
    if (role && INTERACTIVE_ROLES.includes(role)) {
      const detail: Record<string, unknown> = { role };
      if (node.label !== undefined) detail["label"] = node.label;
      const g: Greenline = {
        kind: "a11y",
        severity: "info",
        message: node.label
          ? `${role} "${node.label}"`
          : `${role}`,
        detail,
      };
      if (node.bounds) {
        g.bounds = node.bounds;
        detail["bounds"] = node.bounds;
      }
      out.push(g);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree.root);
  return out;
}

/**
 * The full greenline layer for a component: issue greenlines first (they lead),
 * then spec greenlines for interactive nodes not already annotated at the same
 * bounds (so an interactive node that also has a finding isn't listed twice).
 */
export function buildGreenlines(
  findings: readonly Finding[] | undefined,
  semantics: SemanticTree | undefined,
): Greenline[] {
  const issues = findingsToGreenlines(findings ?? []);
  const specs = specGreenlines(semantics).filter(
    (spec) => !issues.some((issue) => sameBounds(issue.bounds, spec.bounds)),
  );
  return [...issues, ...specs];
}
