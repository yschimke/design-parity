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
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import AjvModule, { type ValidateFunction } from "ajv";

import type { DesignTokens, VerdictStatus } from "@design-parity/core";
import { tokensToDtcg } from "@design-parity/core";

import type { ParityReport, ComponentResult } from "./orchestrate.js";
import schema from "../schema/verdict.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
  addKeyword: (def: Record<string, unknown>) => unknown;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/**
 * The `verdict.json` layout version. Bumped only on an **incompatible** change
 * to {@link BaselineSummary} (a renamed/removed field, a changed type, a
 * tightened required set); additive optional fields do not bump it, so a reader
 * must ignore unknown fields. A PR run loads a baseline written by `main` and
 * checks this against the version it understands before diffing against it —
 * without it the on-branch history can't evolve safely as it accumulates.
 *
 * Mirrors the `formatVersion` the compose-ai-tools reporting-branch
 * `manifest.json` carries (compose-ai-tools#1866); see `docs/report-format.md`.
 */
export const VERDICT_FORMAT_VERSION = 1;

/** Public URL of the published verdict schema, emitted as `$schema`. */
const VERDICT_SCHEMA_REF =
  "https://github.com/yschimke/design-parity/schema/verdict.schema.json";

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
  /** URL of the published schema this document conforms to. */
  $schema?: string;
  /**
   * The {@link VERDICT_FORMAT_VERSION} this document was written at. Lets a
   * reader (a PR run loading the `main` baseline to diff against) detect an
   * incompatible on-branch format before consuming it.
   */
  formatVersion: number;
  /** ISO timestamp the baseline was assembled. */
  generatedAt: string;
  /** The commit the baseline was rendered from, when known. */
  commit?: string;
  direction: ParityReport["direction"];
  status: VerdictStatus;
  blocked: boolean;
  /**
   * Path (relative to the artifact root) of the published design-system DTCG
   * token file ({@link DESIGN_TOKENS_PATH}), when the run exposed any tokens.
   * Lets a consumer discover the known location without scraping the index.
   */
  tokens?: string;
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

/**
 * Committed path (relative to the artifact root) of the design-system token file
 * written to the report branch. Stable and known so anything can link it
 * directly — e.g. Claude Design's GitHub import or a raw fetch:
 * `https://raw.githubusercontent.com/<owner>/<repo>/<report-branch>/tokens/design-system.tokens.json`.
 */
export const DESIGN_TOKENS_PATH = "tokens/design-system.tokens.json";

/** Union a token bag into an accumulator, per category; existing keys win. */
function mergeTokens(into: DesignTokens, from?: DesignTokens): void {
  if (!from) return;
  if (from.colors) into.colors = { ...from.colors, ...into.colors };
  if (from.spacing) into.spacing = { ...from.spacing, ...into.spacing };
  if (from.radius) into.radius = { ...from.radius, ...into.radius };
  if (from.typography) into.typography = { ...from.typography, ...into.typography };
}

/** Overlay `top` onto `base` per category (top wins), dropping empty groups. */
function overlayTokens(base: DesignTokens, top: DesignTokens): DesignTokens {
  const out: DesignTokens = {};
  const colors = { ...base.colors, ...top.colors };
  if (Object.keys(colors).length) out.colors = colors;
  const spacing = { ...base.spacing, ...top.spacing };
  if (Object.keys(spacing).length) out.spacing = spacing;
  const radius = { ...base.radius, ...top.radius };
  if (Object.keys(radius).length) out.radius = radius;
  const typography = { ...base.typography, ...top.typography };
  if (Object.keys(typography).length) out.typography = typography;
  return out;
}

/**
 * The run's design-system token table, aggregated across components, or
 * `undefined` when no source exposed one. The authoritative side per the
 * resolved direction wins on conflict: the candidate render's resolved
 * `themeTokens` in `code-led` (the shipped app's real table), the reference's
 * tokens in `design-led`. The same theme repeats across components, so a union
 * is safe — this is what gets published as DTCG for Claude Design to import.
 */
export function designSystemTokens(report: ParityReport): DesignTokens | undefined {
  const code: DesignTokens = {};
  const design: DesignTokens = {};
  for (const r of report.results) {
    mergeTokens(code, r.candidate?.semantics.themeTokens);
    mergeTokens(design, r.reference?.themeTokens);
    mergeTokens(design, r.reference?.tokens);
  }
  const [base, top] =
    report.direction === "code-led" ? [design, code] : [code, design];
  const merged = overlayTokens(base, top);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** The machine-readable roll-up written as `verdict.json`. */
export function baselineSummary(
  report: ParityReport,
  outDir: string,
  meta: BaselineMeta = {},
  tokensPath?: string,
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
    $schema: VERDICT_SCHEMA_REF,
    formatVersion: VERDICT_FORMAT_VERSION,
    generatedAt: (meta.now ?? new Date()).toISOString(),
    ...(meta.commit ? { commit: meta.commit } : {}),
    direction: report.direction,
    status: report.status,
    blocked: report.blocked,
    ...(tokensPath ? { tokens: tokensPath } : {}),
    components,
    warnings: report.warnings,
  };
}

/** The JSON Schema (draft-07) for `verdict.json`, as a plain object. */
export const verdictSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const verdictSchemaPath = fileURLToPath(
  new URL("../schema/verdict.schema.json", import.meta.url),
);

// `validateFormats: false` keeps the published `format: "date-time"` annotation
// in the schema for tools that honour it, without pulling in `ajv-formats`.
const ajv = new Ajv({ allErrors: true, validateFormats: false });
// `x-design-parity` is a documentation annotation (kind/formatVersion/source
// metadata), not a constraint; register it so ajv's strict mode keeps it.
ajv.addKeyword({ keyword: "x-design-parity", metaSchema: { type: "object" } });
const validateFn: ValidateFunction<BaselineSummary> =
  ajv.compile<BaselineSummary>(schema);

export interface VerdictValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the published verdict schema. */
export function validateVerdict(value: unknown): VerdictValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
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
  }</p>${
    summary.tokens
      ? `\n<p class="meta">Design system: <a href="${escapeHtml(summary.tokens)}"><code>${escapeHtml(summary.tokens)}</code></a> — DTCG tokens (import into Claude Design)</p>`
      : ""
  }
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
  /** Relative path written for the DTCG token file, when the run had tokens. */
  tokensPath?: string;
  summary: BaselineSummary;
}

/**
 * Write `index.html` + `verdict.json` into `outDir` (alongside the per-component
 * subdirs `orchestrate` already populated), plus — when the run exposed any
 * design-system tokens — a DTCG token file at {@link DESIGN_TOKENS_PATH}. All
 * three land on the published report branch, so the token file gets a stable,
 * known URL anyone (Claude Design's import, a raw fetch) can link. Returns the
 * relative paths and the computed summary.
 */
export async function writeBaselineArtifacts(
  outDir: string,
  report: ParityReport,
  meta: BaselineMeta = {},
): Promise<BaselineArtifacts> {
  const tokens = designSystemTokens(report);
  const tokensPath = tokens ? DESIGN_TOKENS_PATH : undefined;
  const summary = baselineSummary(report, outDir, meta, tokensPath);
  await mkdir(outDir, { recursive: true });
  if (tokens) {
    await mkdir(join(outDir, dirname(DESIGN_TOKENS_PATH)), { recursive: true });
    await writeFile(
      join(outDir, DESIGN_TOKENS_PATH),
      JSON.stringify(tokensToDtcg(tokens), null, 2) + "\n",
    );
  }
  await writeFile(join(outDir, "verdict.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(outDir, "index.html"), renderBaselineIndex(summary));
  return {
    indexPath: "index.html",
    verdictPath: "verdict.json",
    ...(tokensPath ? { tokensPath } : {}),
    summary,
  };
}
