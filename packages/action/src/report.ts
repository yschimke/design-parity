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

/**
 * The comment posted when a PR runs against a repo that has **no committed
 * parity setup** — no (or an empty) `design-map.json`. The unattended Action
 * enforces committed deterministic artifacts; it never generates them at run
 * time (Principle 1), so instead of silently guessing it points the user at the
 * interactive bootstrap (issue #11 / the `design-parity-bootstrap` CLI).
 *
 * Carries the same {@link REPORT_MARKER} as a verdict comment, so it updates in
 * place and is replaced by a real verdict on the first run after setup lands.
 */
export function renderBootstrapNotice(): string {
  return [
    REPORT_MARKER,
    "",
    "# Design parity",
    "",
    "ℹ️ **Not set up yet** — this repo has no committed `design-map.json`, so there's nothing to check parity against (no PR is blocked).",
    "",
    "design-parity runs unattended on committed, deterministic artifacts and never guesses your design ↔ code mapping at run time. To set it up, run the interactive bootstrap once and commit what it generates:",
    "",
    "```sh",
    "npx design-parity-bootstrap",
    "```",
    "",
    "It detects your design-system maturity and seeds a starter `design-map.json`, check config, and parity direction (`.design-parity.json`). See [issue #11](https://github.com/yschimke/design-parity/issues/11) for the setup flow.",
  ].join("\n");
}

/**
 * The non-blocking Compose Multiplatform promotion shown on Android-only repos
 * (docs/PRINCIPLES.md, Principle 6). Surfaced only when the committed
 * `cmpCapable` flag is `false`; phrased for the PR comment (the bootstrap output
 * has its own, longer wording). Advisory — it never changes the verdict.
 */
export const CMP_PROMOTION =
  "💡 **Tip — Compose Multiplatform.** This project looks Android-only " +
  "(Jetpack Compose). On Compose Multiplatform it could run parity faster: the " +
  "candidate renders on the JVM/desktop with **no Android emulator**, which is " +
  "cheaper and easier to run unattended. Advisory only — plain Jetpack Compose " +
  "stays fully supported. See [adopting-cmp.md](docs/adopting-cmp.md).";

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

  // Promote CMP to Android-only repos (Principle 6) — non-blocking, never a gate.
  if (report.cmpCapable === false) {
    lines.push("", "---", "", CMP_PROMOTION);
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
