/**
 * `renderHtmlReport` — turn a parity run into one self-contained HTML page.
 *
 * The page inlines everything: CSS in a `<style>`, a small vanilla `<script>`
 * for the overlay/opacity slider and theme/size switches, and every image as a
 * `data:image/png;base64,…` URI. No external requests — it opens offline, from
 * a file, as a CI artifact, or on GitHub Pages.
 *
 * Output is deterministic: same input → byte-identical string. No timestamps,
 * no random ids, no `Date.now()`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

import type { Image, Verdict } from "@design-parity/core";

import { groupFindings, tokenDelta } from "./findings.js";
import { escapeHtml, pngDataUri } from "./html.js";
import type { DiffImage, ReportInput } from "./types.js";
import { pairVariants, type Variant } from "./variants.js";

const STATUS_LABEL = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
} as const;

const SEVERITY_LABEL = {
  info: "info",
  warn: "warn",
  error: "error",
} as const;

/** Inline an image from disk as a data URI, or `undefined` if absent/unreadable. */
function inlineFromDisk(root: string, img: Image | undefined): string | undefined {
  if (!img) return undefined;
  // A source may already hand us a `data:` URI; pass it through untouched.
  if (img.uri.startsWith("data:")) return img.uri;
  const bytes = readFileSync(resolve(root, img.uri));
  return pngDataUri(bytes);
}

interface Panel {
  label: string;
  src?: string;
  width?: number;
  height?: number;
}

function panelMarkup(panel: Panel, role: string): string {
  const inner = panel.src
    ? `<img class="panel-img" data-role="${role}" src="${panel.src}" alt="${escapeHtml(panel.label)}" />`
    : `<div class="panel-empty">no image</div>`;
  return `<figure class="panel" data-role="${role}">
            <figcaption>${escapeHtml(panel.label)}</figcaption>
            <div class="panel-body">${inner}</div>
          </figure>`;
}

function variantMarkup(
  variant: Variant,
  index: number,
  refSrc: string | undefined,
  candSrc: string | undefined,
  diffSrc: string | undefined,
): string {
  const meta = [variant.state, variant.theme, variant.size]
    .filter(Boolean)
    .map((v) => `<span class="chip">${escapeHtml(String(v))}</span>`)
    .join(" ");

  const ref: Panel = { label: "Reference", src: refSrc };
  const cand: Panel = { label: "Candidate", src: candSrc };
  const diff: Panel = { label: "Diff", src: diffSrc };

  // The overlay stacks reference under candidate; the slider sets candidate
  // opacity so you can wipe between them. Only meaningful when both exist.
  const overlay =
    refSrc && candSrc
      ? `<div class="overlay">
           <div class="overlay-stack">
             <img class="overlay-ref" src="${refSrc}" alt="reference" />
             <img class="overlay-cand" src="${candSrc}" alt="candidate" data-overlay="${index}" />
           </div>
           <label class="overlay-control">
             <span>reference</span>
             <input type="range" min="0" max="100" value="100" data-slider="${index}" />
             <span>candidate</span>
           </label>
         </div>`
      : "";

  return `<section class="variant" data-variant="${escapeHtml(variant.key)}">
            <header class="variant-head">
              <h3>${escapeHtml(variant.key)}</h3>
              <div class="variant-meta">${meta}</div>
            </header>
            <div class="triptych">
              ${panelMarkup(ref, "reference")}
              ${panelMarkup(cand, "candidate")}
              ${panelMarkup(diff, "diff")}
            </div>
            ${overlay}
          </section>`;
}

function findingsMarkup(verdict: Verdict): string {
  const sections = groupFindings(verdict.findings);
  if (sections.length === 0) {
    return `<p class="no-findings">No parity findings — candidate matches the reference spec.</p>`;
  }
  return sections
    .map((section) => {
      const items = section.findings
        .map((f) => {
          const delta = tokenDelta(f);
          const deltaMarkup =
            delta && (delta.expected !== undefined || delta.actual !== undefined)
              ? `<div class="delta">
                   ${delta.token ? `<code>${escapeHtml(delta.token)}</code>` : ""}
                   <span class="expected">expected ${escapeHtml(delta.expected ?? "—")}</span>
                   <span class="actual">actual ${escapeHtml(delta.actual ?? "—")}</span>
                 </div>`
              : "";
          return `<li class="finding sev-${f.severity}">
                    <span class="sev-tag">${SEVERITY_LABEL[f.severity]}</span>
                    <div class="finding-body">
                      <span class="finding-msg">${escapeHtml(f.message)}</span>
                      ${deltaMarkup}
                    </div>
                  </li>`;
        })
        .join("\n");
      return `<div class="finding-section">
                <h3>${escapeHtml(section.title)}</h3>
                <ul class="finding-list">${items}</ul>
              </div>`;
    })
    .join("\n");
}

function scoresMarkup(verdict: Verdict): string {
  const scores = verdict.visualScores;
  if (!scores || Object.keys(scores).length === 0) return "";
  const rows = Object.entries(scores)
    .map(
      ([key, score]) =>
        `<li><code>${escapeHtml(key)}</code> ${
          score === 0
            ? "<span class=\"match\">match</span>"
            : `<span class="differ">${(score * 100).toFixed(1)}% differ</span>`
        }</li>`,
    )
    .join("\n");
  return `<div class="finding-section">
            <h3>Visual scores</h3>
            <ul class="score-list">${rows}</ul>
          </div>`;
}

const STYLE = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0f14;color:#e7e7ef}
a{color:inherit}
header.page{padding:24px 28px;border-bottom:1px solid #26262f}
header.page h1{margin:0 0 6px;font-size:18px}
.subtitle{color:#9a9ab0;font-size:13px}
.status{display:inline-block;margin-left:10px;padding:2px 10px;border-radius:999px;font-weight:600;font-size:12px;vertical-align:middle}
.status-pass{background:#16351f;color:#7ee29a}
.status-warn{background:#3a3115;color:#e8c66b}
.status-fail{background:#3a1820;color:#f08a9c}
main{padding:20px 28px;display:grid;gap:24px;max-width:1200px}
.variant{border:1px solid #26262f;border-radius:10px;padding:16px;background:#15151c}
.variant-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.variant-head h3{margin:0;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.chip{display:inline-block;padding:1px 8px;border-radius:6px;background:#222230;color:#b8b8cc;font-size:11px;margin-left:4px}
.triptych{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.panel{margin:0;border:1px solid #26262f;border-radius:8px;overflow:hidden;background:#0c0c11}
.panel figcaption{padding:6px 10px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#9a9ab0;border-bottom:1px solid #26262f}
.panel-body{display:flex;align-items:center;justify-content:center;min-height:64px;padding:10px}
.panel-img{max-width:100%;height:auto;image-rendering:pixelated}
.panel-empty{color:#666;font-size:12px;padding:20px}
.overlay{margin-top:14px}
.overlay-stack{position:relative;display:inline-block;border:1px solid #26262f;border-radius:8px;overflow:hidden;background:#0c0c11}
.overlay-stack img{display:block;max-width:100%}
.overlay-cand{position:absolute;inset:0;width:100%;height:100%}
.overlay-control{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12px;color:#9a9ab0}
.overlay-control input{flex:1;max-width:280px}
.findings{border:1px solid #26262f;border-radius:10px;padding:16px;background:#15151c}
.finding-section+.finding-section{margin-top:16px}
.finding-section h3{margin:0 0 8px;font-size:13px;color:#c9c9dd}
.finding-list,.score-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.finding{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:8px;background:#0f0f15;border:1px solid #222230}
.sev-tag{flex:none;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:999px;font-weight:700}
.sev-info .sev-tag{background:#16283a;color:#7db4e8}
.sev-warn .sev-tag{background:#3a3115;color:#e8c66b}
.sev-error .sev-tag{background:#3a1820;color:#f08a9c}
.finding-body{display:flex;flex-direction:column;gap:4px}
.delta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:#9a9ab0}
.delta code{background:#222230;padding:1px 6px;border-radius:5px}
.delta .expected{color:#7ee29a}
.delta .actual{color:#f08a9c}
.score-list code{background:#222230;padding:1px 6px;border-radius:5px}
.match{color:#7ee29a}
.differ{color:#e8c66b}
.no-findings{color:#7ee29a;margin:0}
@media (max-width:760px){.triptych{grid-template-columns:1fr}}`;

const SCRIPT = `(function(){
  var sliders=document.querySelectorAll('input[data-slider]');
  for(var i=0;i<sliders.length;i++){
    (function(slider){
      var id=slider.getAttribute('data-slider');
      var cand=document.querySelector('img[data-overlay="'+id+'"]');
      function apply(){ if(cand){ cand.style.opacity=(slider.value/100).toString(); } }
      slider.addEventListener('input',apply);
      apply();
    })(sliders[i]);
  }
})();`;

/**
 * Render a parity run as one self-contained HTML document string.
 *
 * @see ReportInput
 */
export function renderHtmlReport(input: ReportInput): string {
  const { reference, candidate, verdict } = input;
  const root = input.repoRoot ?? cwd();

  const diffByKey = new Map<string, DiffImage>();
  for (const d of input.diffImages ?? []) diffByKey.set(d.key, d);

  const variants = pairVariants(reference.referenceImages, candidate.images);

  const variantsHtml = variants
    .map((variant, index) => {
      const refSrc = inlineFromDisk(root, variant.reference);
      const candSrc = inlineFromDisk(root, variant.candidate);
      const diff = diffByKey.get(variant.key);
      const diffSrc = diff ? pngDataUri(diff.png) : undefined;
      return variantMarkup(variant, index, refSrc, candSrc, diffSrc);
    })
    .join("\n");

  const hasVariants = variants.length > 0;
  const variantsSection = hasVariants
    ? variantsHtml
    : `<section class="variant"><p class="panel-empty">No images for this verdict — findings only.</p></section>`;

  const status = verdict.status;
  const title = `Parity report: ${escapeHtml(verdict.componentId)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="page">
  <h1>${escapeHtml(verdict.componentId)}<span class="status status-${status}">${STATUS_LABEL[status]}</span></h1>
  <div class="subtitle">${escapeHtml(reference.source)} reference vs candidate render</div>
</header>
<main>
${variantsSection}
<section class="findings">
${findingsMarkup(verdict)}
${scoresMarkup(verdict)}
</section>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
