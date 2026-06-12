/**
 * Render a {@link ParityReport} as the single markdown comment the bot posts on
 * a PR (and the CLI prints). a11y + i18n lead each component's section (that
 * ordering is owned by the diff summary); this layer adds the overall verdict,
 * the direction-driven blocking note, and the per-component roll-up.
 */
import type { ParityReport } from "./orchestrate.js";

const STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;

/** Stable marker so the GitHub surface can find and update its own comment. */
export const REPORT_MARKER = "<!-- design-parity-report -->";

export function renderReport(report: ParityReport): string {
  const lines: string[] = [REPORT_MARKER];

  const headline = report.blocked
    ? `${STATUS_ICON.fail} **Parity check failed** — blocking (\`${report.direction}\`)`
    : `${STATUS_ICON[report.status]} **Parity ${report.status}** (\`${report.direction}\`${
        report.status === "fail" ? ", advisory" : ""
      })`;
  lines.push("", `# Design parity`, "", headline);

  const checked = report.results.filter((r) => r.verdict);
  if (checked.length === 0) {
    lines.push("", "_No components were checked._");
  }

  for (const r of report.results) {
    if (r.summary) {
      lines.push("", "---", "", r.summary);
    } else if (r.status === "skipped") {
      lines.push("", "---", "", `### \`${r.code}\` — skipped`, `_${r.note}._`);
    } else if (r.status === "error") {
      lines.push(
        "",
        "---",
        "",
        `### \`${r.code}\` — ⚠️ not checked`,
        `_Adapter/diff error (failed soft): ${r.note}._`,
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push(
      "",
      "---",
      "",
      "<details><summary>Warnings</summary>",
      "",
      ...report.warnings.map((w) => `- ${w}`),
      "",
      "</details>",
    );
  }

  return lines.join("\n");
}
