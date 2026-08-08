/**
 * Group verdict findings into value-ordered sections (docs/PRINCIPLES.md,
 * Principle 2): accessibility + i18n first, then token compliance, then
 * semantics, then the raw visual diff. Mirrors the markdown summary so the two
 * surfaces agree.
 */
import type { Finding, FindingKind } from "@design-parity/core";

export interface FindingSection {
  title: string;
  kinds: FindingKind[];
}

export const SECTIONS: FindingSection[] = [
  { title: "Accessibility & i18n", kinds: ["contrast", "a11y", "i18n"] },
  { title: "Token compliance", kinds: ["token"] },
  { title: "Pairing", kinds: ["pairing"] },
  { title: "Semantics", kinds: ["semantic"] },
  { title: "Layout", kinds: ["layout"] },
  { title: "Visual", kinds: ["visual"] },
];

export interface GroupedSection {
  title: string;
  findings: Finding[];
}

/** Findings bucketed by section, in value order; empty sections dropped. */
export function groupFindings(findings: readonly Finding[]): GroupedSection[] {
  const grouped: GroupedSection[] = [];
  for (const section of SECTIONS) {
    const matched = findings.filter((f) => section.kinds.includes(f.kind));
    if (matched.length > 0) grouped.push({ title: section.title, findings: matched });
  }
  return grouped;
}

/**
 * Pull an expected/actual token delta out of a finding's `detail` when present
 * (the diff engine stamps `{ token, expected, actual, delta }`).
 */
export interface TokenDelta {
  token?: string;
  expected?: string;
  actual?: string;
}

export function tokenDelta(finding: Finding): TokenDelta | undefined {
  const d = finding.detail;
  if (!d) return undefined;
  const has =
    "token" in d || "expected" in d || "actual" in d;
  if (!has) return undefined;
  const fmt = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : String(v);
  return {
    token: fmt(d["token"]),
    expected: fmt(d["expected"]),
    actual: fmt(d["actual"]),
  };
}
