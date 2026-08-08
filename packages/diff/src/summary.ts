/**
 * Human-readable markdown summary of a {@link Verdict}.
 *
 * The machine `Verdict` is for downstream consumers; this is what a reviewer
 * reads in the PR comment. Sections are ordered by value (Principle 2):
 * a11y + i18n first, then tokens, then semantics, then the visual diff.
 */
import type { Finding, FindingKind, Verdict } from "@design-parity/core";

const STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
const SEVERITY_ICON = { info: "ℹ️", warn: "⚠️", error: "❌" } as const;

interface Section {
  title: string;
  kinds: FindingKind[];
}

// a11y + i18n lead (Principle 2); contrast/a11y/i18n are the checks signals.
const SECTIONS: Section[] = [
  { title: "Accessibility & i18n", kinds: ["contrast", "a11y", "i18n"] },
  { title: "Token compliance", kinds: ["token"] },
  // Before the comparison sections: what the reference depicts, and what could
  // not be compared, qualifies everything reported after it.
  { title: "Pairing", kinds: ["pairing"] },
  { title: "Semantics", kinds: ["semantic"] },
  { title: "Layout", kinds: ["layout"] },
  { title: "Visual", kinds: ["visual"] },
];

function renderFinding(f: Finding): string {
  return `- ${SEVERITY_ICON[f.severity]} ${f.message}`;
}

/** Render a verdict as a self-contained markdown block. */
export function renderSummary(verdict: Verdict): string {
  const lines: string[] = [
    `## Parity verdict: \`${verdict.componentId}\` — ${STATUS_ICON[verdict.status]} ${verdict.status}`,
  ];

  for (const section of SECTIONS) {
    const matched = verdict.findings.filter((f) =>
      section.kinds.includes(f.kind),
    );
    if (matched.length === 0) continue;
    lines.push("", `**${section.title}**`, ...matched.map(renderFinding));
  }

  const scores = verdict.visualScores;
  if (scores && Object.keys(scores).length > 0) {
    const detail = Object.entries(scores)
      .map(([key, score]) =>
        score === 0
          ? `\`${key}\` match`
          : `\`${key}\` ${(score * 100).toFixed(1)}% differ`,
      )
      .join(", ");
    lines.push("", `_Visual diff: ${detail}._`);
  }

  if (verdict.findings.length === 0) {
    lines.push("", "No parity findings — candidate matches the reference spec.");
  }

  return lines.join("\n");
}
