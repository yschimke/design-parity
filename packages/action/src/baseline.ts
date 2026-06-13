/**
 * Assemble the browsable baseline artifacts published to the permanent branch
 * (issue #56). `orchestrate` already writes each component's self-contained
 * `report.html` triptych into its own subdir of `outDir`; this layer adds the
 * two top-level files that make the branch a stable, always-current view of the
 * dev branch's parity state:
 *
 * - **`index.html`** — the landing page: overall verdict + a row per component
 *   linking into its `report.html`. Self-contained, no assets, no JS.
 * - **`verdict.json`** — the machine-readable roll-up (status, direction, per
 *   component verdict + relative report path). This is the baseline a PR run can
 *   load to diff its candidate against `main` rather than only the static
 *   design reference.
 *
 * The HTML/JSON builders are pure (string / object in, no I/O); only
 * {@link writeBaselineArtifacts} touches disk.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { VerdictStatus } from "@design-parity/core";

import type { ParityReport, ComponentResult } from "./orchestrate.js";

const STATUS_ICON: Record<VerdictStatus, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

export interface BaselineComponent {
  code: string;
  source?: string;
  status: ComponentResult["status"];
  verdict?: VerdictStatus;
  /** Counts by severity, when a verdict was produced. */
  findings?: number;
  /** Path to the component's `report.html`, relative to the artifact root. */
  report?: string;
  note?: string;
}

export interface BaselineSummary {
  /** ISO timestamp the baseline was assembled. */
  generatedAt: string;
  /** The commit the baseline was rendered from, when known. */
  commit?: string;
  direction: ParityReport["direction"];
  status: VerdictStatus;
  blocked: boolean;
  components: BaselineComponent[];
  warnings: string[];
}

export interface BaselineMeta {
  /** Source commit SHA (`GITHUB_SHA`), recorded in the summary + index. */
  commit?: string;
  /** Override the timestamp (tests); defaults to `new Date()`. */
  now?: Date;
}

/** Relative path from the artifact root to a component's report, if it has one. */
function reportRel(outDir: string, result: ComponentResult): string | undefined {
  return result.reportPath ? relative(outDir, result.reportPath) : undefined;
}

/** The machine-readable roll-up written as `verdict.json`. */
export function baselineSummary(
  report: ParityReport,
  outDir: string,
  meta: BaselineMeta = {},
): BaselineSummary {
  const components: BaselineComponent[] = report.results.map((r) => {
    const rel = reportRel(outDir, r);
    return {
      code: r.code,
      ...(r.source ? { source: r.source } : {}),
      status: r.status,
      ...(r.verdict ? { verdict: r.verdict.status } : {}),
      ...(r.verdict ? { findings: r.verdict.findings.length } : {}),
      ...(rel ? { report: rel } : {}),
      ...(r.note ? { note: r.note } : {}),
    };
  });
  return {
    generatedAt: (meta.now ?? new Date()).toISOString(),
    ...(meta.commit ? { commit: meta.commit } : {}),
    direction: report.direction,
    status: report.status,
    blocked: report.blocked,
    components,
    warnings: report.warnings,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The self-contained `index.html` landing page. */
export function renderBaselineIndex(summary: BaselineSummary): string {
  const headline = summary.blocked
    ? `${STATUS_ICON.fail} Parity failed — blocking (${summary.direction})`
    : `${STATUS_ICON[summary.status]} Parity ${summary.status} (${summary.direction})`;

  const rows = summary.components
    .map((c) => {
      const icon = c.verdict ? STATUS_ICON[c.verdict] : "—";
      const state = c.verdict ?? c.status;
      const label = c.report
        ? `<a href="${escapeHtml(c.report)}">${escapeHtml(c.code)}</a>`
        : escapeHtml(c.code);
      const detail = c.note ? escapeHtml(c.note) : "";
      return (
        `<tr><td>${icon}</td><td>${label}</td>` +
        `<td>${escapeHtml(c.source ?? "")}</td>` +
        `<td>${escapeHtml(state)}</td>` +
        `<td>${escapeHtml(detail)}</td></tr>`
      );
    })
    .join("\n");

  const warnings =
    summary.warnings.length > 0
      ? `<details><summary>${summary.warnings.length} warning(s)</summary><ul>` +
        summary.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
        `</ul></details>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design parity baseline</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  .meta { color: #666; font-size: 0.85rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; }
  th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>${escapeHtml(headline)}</h1>
<p class="meta">Generated ${escapeHtml(summary.generatedAt)}${
    summary.commit ? ` · commit <code>${escapeHtml(summary.commit.slice(0, 12))}</code>` : ""
  }</p>
<table>
<thead><tr><th></th><th>Component</th><th>Source</th><th>State</th><th>Note</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="5">No components were checked.</td></tr>'}
</tbody>
</table>
${warnings}
</body>
</html>
`;
}

export interface BaselineArtifacts {
  /** Relative path written: `index.html`. */
  indexPath: string;
  /** Relative path written: `verdict.json`. */
  verdictPath: string;
  summary: BaselineSummary;
}

/**
 * Write `index.html` + `verdict.json` into `outDir` (alongside the per-component
 * subdirs `orchestrate` already populated). Returns the relative paths and the
 * computed summary.
 */
export async function writeBaselineArtifacts(
  outDir: string,
  report: ParityReport,
  meta: BaselineMeta = {},
): Promise<BaselineArtifacts> {
  const summary = baselineSummary(report, outDir, meta);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "verdict.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(outDir, "index.html"), renderBaselineIndex(summary));
  return { indexPath: "index.html", verdictPath: "verdict.json", summary };
}
