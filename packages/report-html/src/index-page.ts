/**
 * `renderIndex` — the **branch landing page**.
 *
 * The orchestrator writes one self-contained `report.html` per component into
 * its own subdir. That's great once you know which file to open, but a human
 * landing on the published branch (`design-parity/main`) sees only a list of
 * machine-named directories with no entry point. This stitches them together:
 *
 * - `README.md` — what GitHub renders when you open the branch: a "generated,
 *   do not edit" banner, the source commit, and a table linking each component
 *   to its report.
 * - `index.html` — a self-contained landing page for GitHub Pages / local view.
 *
 * GitHub serves a linked `.html` blob as source (it won't render the slider
 * JS), so when the published `repoSlug` + `branch` are known the README links
 * are wrapped through htmlpreview.github.io so they render on click; otherwise
 * they fall back to relative links (which still navigate to the file).
 *
 * Output is deterministic: same input → byte-identical strings. No timestamps,
 * random ids, or `Date.now()` — entries render in the order given.
 */
import type { DesignSource, VerdictStatus } from "@design-parity/core";

import { escapeHtml } from "./html.js";

/** A component status as shown on the landing page (verdict or non-verdict). */
export type IndexStatus = VerdictStatus | "skipped" | "error";

export interface IndexEntry {
  /** Component id, e.g. `ui/DeviceBody.kt#DeviceBodyPreview`. */
  code: string;
  /**
   * The design source this row was diffed against. Shown as a "Source" column
   * when any entry carries one — the head-to-head view when a single code is
   * diffed against several sources in one run (issue #106).
   */
  source?: DesignSource;
  /** Verdict status, or why the component produced no verdict. */
  status: IndexStatus;
  /** Path to the component's `report.html`, relative to the branch root. */
  reportPath?: string;
  /**
   * The real candidate render (reality, not the mock) as a `data:` URI, shown as
   * a small preview on the landing page. Inlined so `index.html` stays
   * self-contained. Omitted when there's no candidate (e.g. a skipped component).
   */
  thumbnail?: string;
}

export interface IndexInput {
  /** Page title (default `Design parity`). */
  title?: string;
  /** Candidate commit the reports were rendered from, shown if provided. */
  sourceCommit?: string;
  /**
   * `owner/repo` the index is published to. With {@link branch}, README report
   * links are wrapped through htmlpreview.github.io so they render on click.
   */
  repoSlug?: string;
  /** Branch the index is published to (e.g. `design-parity/main`). */
  branch?: string;
  /** Optional overview image at the branch root, e.g. `candidates.bundle.png`. */
  bundleImage?: string;
  /** One row per component, in display order. */
  entries: IndexEntry[];
}

const STATUS_TEXT: Record<IndexStatus, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
  skipped: "Skipped",
  error: "Error",
};

const STATUS_EMOJI: Record<IndexStatus, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  skipped: "⏭️",
  error: "🚫",
};

function short(sha: string): string {
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

/**
 * A compact display label for a component handle. Component ids are often a full
 * source path (`…/ui/DeviceBodyPreviews.kt#DeviceBodyPreview`) which overflows the
 * landing-page table on narrow screens, so show just the file basename and member
 * (`DeviceBodyPreviews.kt#DeviceBodyPreview`). The full handle stays available —
 * as the row's `title` tooltip in `index.html` and on each report's own heading.
 */
export function shortCode(code: string): string {
  const hash = code.indexOf("#");
  const path = hash >= 0 ? code.slice(0, hash) : code;
  const member = hash >= 0 ? code.slice(hash) : "";
  const base = path.slice(path.lastIndexOf("/") + 1);
  return `${base}${member}`;
}

/** Escape a cell for a GitHub-flavored markdown table. */
function mdCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Link target for a branch-relative `.html` path. GitHub serves a linked `.html`
 * blob as source, so when the published repo + branch are known the link is
 * wrapped through htmlpreview.github.io to render on click (works without Pages);
 * otherwise it stays relative (right for Pages / local view).
 */
function previewHref(path: string, input: IndexInput): string {
  if (input.repoSlug && input.branch) {
    const blob = `https://github.com/${input.repoSlug}/blob/${input.branch}/${path}`;
    return `https://htmlpreview.github.io/?${blob}`;
  }
  return `./${path}`;
}

/**
 * GitHub commit-history URL for a branch-relative path, or `undefined` when the
 * repo isn't known. Since `report.html` is regenerated whenever a screen's code
 * or mock changes, its history is that screen's change timeline — provided the
 * publish step commits each run rather than force-updating the branch.
 */
function historyHref(path: string, input: IndexInput): string | undefined {
  if (input.repoSlug && input.branch) {
    return `https://github.com/${input.repoSlug}/commits/${input.branch}/${path}`;
  }
  return undefined;
}

/** Render the branch's `README.md`. */
export function renderReadme(input: IndexInput): string {
  const title = input.title ?? "Design parity";
  const lines: string[] = [`# ${title}`, ""];

  const commit = input.sourceCommit
    ? ` Rendered from \`${short(input.sourceCommit)}\` — see [\`SOURCE_COMMIT\`](./SOURCE_COMMIT).`
    : " Rendered from the commit in [`SOURCE_COMMIT`](./SOURCE_COMMIT).";
  lines.push(
    `> **Generated by [design-parity](https://github.com/yschimke/design-parity) — do not edit by hand.**`,
    `> This branch is rebuilt on every run.${commit}`,
    "",
  );

  // A one-click previewable entry to the whole board (renders the rendered
  // `index.html` with thumbnails), only useful once it resolves to htmlpreview.
  if (input.repoSlug && input.branch) {
    lines.push(`[**Open the board →**](${previewHref("index.html", input)}) — rendered previews of every screen.`, "");
  }

  if (input.bundleImage) {
    lines.push(`![Candidate overview](./${input.bundleImage})`, "");
  }

  const hasHistory = !!(input.repoSlug && input.branch);
  // The Source column only appears when a row carries a source (issue #106), so
  // single-source boards render exactly as before.
  const hasSource = input.entries.some((e) => e.source);
  const header = ["Component"];
  if (hasSource) header.push("Source");
  header.push("Status", "Report");
  if (hasHistory) header.push("History");
  lines.push(
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  );
  for (const e of input.entries) {
    const cells = [mdCell(shortCode(e.code))];
    if (hasSource) cells.push(e.source ? mdCell(e.source) : "—");
    cells.push(`${STATUS_EMOJI[e.status]} ${STATUS_TEXT[e.status]}`);
    cells.push(
      e.reportPath ? `[report](${previewHref(e.reportPath, input)})` : "—",
    );
    if (hasHistory) {
      cells.push(
        e.reportPath && historyHref(e.reportPath, input)
          ? `[history](${historyHref(e.reportPath, input)})`
          : "—",
      );
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "Each report is a self-contained HTML page — open one in a browser to view the",
    "reference / candidate / diff comparison. GitHub shows a linked `.html` as",
    "source; use the rendered links above, GitHub Pages, or download and open it.",
    "",
  );
  return lines.join("\n");
}

const STYLE = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0f14;color:#e7e7ef}
a{color:#9db8ff}
header.page{padding:24px 28px;border-bottom:1px solid #26262f}
header.page h1{margin:0 0 6px;font-size:18px}
.subtitle{color:#9a9ab0;font-size:13px}
.subtitle code{background:#222230;padding:1px 6px;border-radius:5px}
main{padding:20px 28px;max-width:900px}
.overview{max-width:100%;border:1px solid #26262f;border-radius:10px;margin-bottom:20px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #26262f;font-size:13px;vertical-align:top}
th{color:#9a9ab0;font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
td.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
.thumb{display:block;max-height:140px;max-width:200px;border:1px solid #26262f;border-radius:6px;background:#0c0c11;image-rendering:auto}
@media (max-width:560px){main{padding:16px}th,td{padding:6px 8px}.thumb{max-width:110px;max-height:90px}}
.status{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:12px}
.status-pass{background:#16351f;color:#7ee29a}
.status-warn{background:#3a3115;color:#e8c66b}
.status-fail{background:#3a1820;color:#f08a9c}
.status-skipped{background:#222230;color:#b8b8cc}
.status-error{background:#3a1820;color:#f08a9c}
.muted{color:#666}`;

function rowMarkup(
  e: IndexEntry,
  input: IndexInput,
  hasHistory: boolean,
  hasSource: boolean,
): string {
  const status = `<span class="status status-${e.status}">${STATUS_TEXT[e.status]}</span>`;
  const report = e.reportPath
    ? `<a href="${escapeHtml(previewHref(e.reportPath, input))}">report</a>`
    : `<span class="muted">—</span>`;
  const preview = e.thumbnail
    ? `<img class="thumb" src="${e.thumbnail}" alt="${escapeHtml(e.code)} candidate render" loading="lazy" />`
    : `<span class="muted">—</span>`;
  const href = e.reportPath ? historyHref(e.reportPath, input) : undefined;
  const historyCell = hasHistory
    ? `<td>${href ? `<a href="${escapeHtml(href)}">history</a>` : `<span class="muted">—</span>`}</td>`
    : "";
  const sourceCell = hasSource
    ? `<td>${e.source ? escapeHtml(e.source) : `<span class="muted">—</span>`}</td>`
    : "";
  const code = `<td class="code" title="${escapeHtml(e.code)}">${escapeHtml(shortCode(e.code))}</td>`;
  return `<tr><td>${preview}</td>${code}${sourceCell}<td>${status}</td><td>${report}</td>${historyCell}</tr>`;
}

/** Render the branch's self-contained `index.html` landing page. */
export function renderIndexHtml(input: IndexInput): string {
  const title = input.title ?? "Design parity";
  const commit = input.sourceCommit
    ? `Rendered from <code>${escapeHtml(short(input.sourceCommit))}</code>`
    : "Generated by design-parity";
  const overview = input.bundleImage
    ? `<img class="overview" src="./${escapeHtml(input.bundleImage)}" alt="Candidate overview" />`
    : "";
  const hasHistory = !!(input.repoSlug && input.branch);
  const hasSource = input.entries.some((e) => e.source);
  const rows = input.entries
    .map((e) => rowMarkup(e, input, hasHistory, hasSource))
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="page">
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${commit} — generated by design-parity, do not edit by hand.</div>
</header>
<main>
${overview}
<table>
<thead><tr><th>Preview</th><th>Component</th>${hasSource ? "<th>Source</th>" : ""}<th>Status</th><th>Report</th>${hasHistory ? "<th>History</th>" : ""}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</main>
</body>
</html>
`;
}

/** Render both branch landing artifacts from one input. */
export function renderIndex(input: IndexInput): { readme: string; html: string } {
  return { readme: renderReadme(input), html: renderIndexHtml(input) };
}
