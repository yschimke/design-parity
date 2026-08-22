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

import type {
  Image,
  ReferenceProperty,
  SemanticNode,
  SemanticTree,
  Verdict,
} from "@design-parity/core";

import { groupFindings, tokenDelta } from "./findings.js";
import { escapeHtml, isSvgSource, pngDataUri, svgDataUri } from "./html.js";
import { annotationSvg, type AnnotationSvgOptions, type LayoutDelta } from "./overlay.js";
import {
  compareTypography,
  normalizeFontFamily,
  type TypographyComparison,
  type TypographyGroup,
} from "./typography.js";
import type { DiffImage, ReportInput } from "./types.js";
import { inCodeUnits } from "./units.js";
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
  // A committed reference may ship as vector SVG (crisp at any zoom) rather than
  // a rasterised PNG; wrap it with the matching mime so the browser renders it.
  return isSvgSource(img.uri) ? svgDataUri(bytes) : pngDataUri(bytes);
}

/** Column order for the theme matrix: light first, then dark, then any extras. */
const THEME_ORDER: Record<string, number> = { light: 0, dark: 1 };

interface Rendered {
  variant: Variant;
  index: number;
  refSrc?: string;
  candSrc?: string;
  diffSrc?: string;
}

/** Stable DOM id for a variant's detail section — matrix cells anchor to it. */
function variantId(key: string): string {
  const slug = key
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `v-${slug}`;
}

/** Column header for a theme, or "Default" for the theme-less column. */
function themeLabel(theme?: string): string {
  if (!theme) return "Default";
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

/** Row key for the matrix: the variant's state, plus its size when present. */
function rowKey(variant: Variant): string {
  return [variant.state, variant.size].filter(Boolean).join(" · ");
}

/**
 * The candidate-render matrix: one row per `state (· size)`, one column per
 * theme (light, then dark, then any other theme, then a theme-less column when
 * some variant omits it). Each intersection shows that variant's candidate
 * render, linking down to its full reference|candidate|diff detail. Themes are
 * the columns so light/dark sit side by side at a glance.
 */
function matrixMarkup(rendered: Rendered[]): string {
  // Columns: distinct themes in light→dark→… order, then a theme-less column.
  const themed = new Set<string>();
  let hasUntyped = false;
  for (const r of rendered) {
    if (r.variant.theme === undefined) hasUntyped = true;
    else themed.add(r.variant.theme);
  }
  const columns: (string | undefined)[] = [...themed].sort(
    (a, b) =>
      (THEME_ORDER[a] ?? 99) - (THEME_ORDER[b] ?? 99) || a.localeCompare(b),
  );
  if (hasUntyped) columns.push(undefined);

  // Rows in first-appearance order (pairVariants is already stable).
  const rowOrder: string[] = [];
  const rowsByKey = new Map<string, Rendered[]>();
  for (const r of rendered) {
    const k = rowKey(r.variant);
    const bucket = rowsByKey.get(k);
    if (bucket) bucket.push(r);
    else {
      rowsByKey.set(k, [r]);
      rowOrder.push(k);
    }
  }

  const head = `<tr><th class="matrix-corner">state</th>${columns
    .map((t) => `<th scope="col">${escapeHtml(themeLabel(t))}</th>`)
    .join("")}</tr>`;

  const body = rowOrder
    .map((k) => {
      const cells = columns
        .map((theme) => {
          const r = rowsByKey.get(k)?.find((x) => x.variant.theme === theme);
          if (!r)
            return `<td class="matrix-cell"><span class="panel-empty">—</span></td>`;
          const vector = r.candSrc && isSvgSource(r.candSrc) ? " is-vector" : "";
          const inner = r.candSrc
            ? `<a class="matrix-link" href="#${variantId(r.variant.key)}"><img class="matrix-img${vector}" src="${r.candSrc}" alt="${escapeHtml(r.variant.key)} candidate render" loading="lazy" /></a>`
            : `<span class="panel-empty">no candidate</span>`;
          return `<td class="matrix-cell">${inner}</td>`;
        })
        .join("");
      return `<tr><th class="matrix-row" scope="row">${escapeHtml(k)}</th>${cells}</tr>`;
    })
    .join("\n");

  return `<section class="matrix-wrap">
            <table class="matrix">
              <thead>${head}</thead>
              <tbody>${body}</tbody>
            </table>
          </section>`;
}

interface Panel {
  label: string;
  src?: string;
  width?: number;
  height?: number;
}

function panelMarkup(
  panel: Panel,
  role: string,
  tree?: SemanticTree,
  deltas?: readonly LayoutDelta[],
  opts?: AnnotationSvgOptions,
): string {
  let inner: string;
  if (panel.src) {
    const vector = isSvgSource(panel.src) ? " is-vector" : "";
    const img = `<img class="panel-img${vector}" data-role="${role}" src="${panel.src}" alt="${escapeHtml(panel.label)}" />`;
    // When the panel has a semantic tree, overlay its annotation layers. The
    // image defines the box; the SVG is stretched over it (see .panel-figure).
    const anno = annotationSvg(tree, deltas, opts);
    inner = anno ? `<div class="panel-figure">${img}${anno}</div>` : img;
  } else {
    inner = `<div class="panel-empty">no image</div>`;
  }
  return `<figure class="panel" data-role="${role}">
            <figcaption>${escapeHtml(panel.label)}</figcaption>
            <div class="panel-body">${inner}</div>
          </figure>`;
}

type TypographyField = "token" | "family" | "size" | "lineHeight" | "weight" | "tracking" | "style";

function typographyValue(group: TypographyGroup | undefined, field: TypographyField): string {
  if (!group) return "—";
  const type = group.typography;
  if (field === "token") return group.token ?? "unmapped";
  if (field === "family") return type.fontFamily ?? "unspecified";
  if (field === "size") return type.fontSize === undefined ? "—" : `${+type.fontSize}sp`;
  if (field === "lineHeight") return type.lineHeight === undefined ? "—" : String(+type.lineHeight);
  if (field === "weight") return type.fontWeight === undefined ? "—" : String(type.fontWeight);
  if (field === "tracking") return type.letterSpacing === undefined ? "default" : String(+type.letterSpacing);
  return type.fontStyle ?? "normal";
}

function typographyComparable(group: TypographyGroup | undefined, field: TypographyField): string {
  if (!group) return "—";
  if (field === "family") return (normalizeFontFamily(group.typography.fontFamily) ?? "unspecified").toLowerCase();
  if (field === "size") return group.typography.fontSize === undefined ? "—" : String(+group.typography.fontSize);
  return typographyValue(group, field).toLowerCase();
}

function typographyInline(
  side: "Reference" | "Candidate",
  group: TypographyGroup | undefined,
  other: TypographyGroup | undefined,
  baseline: TypographyGroup | undefined,
): string {
  if (!group) return `<span class="type-inline"><span class="type-side">${side}</span> · No matching usage</span>`;
  const changed = (field: TypographyField): boolean =>
    !!other && typographyComparable(group, field) !== typographyComparable(other, field);
  const overridden = (field: TypographyField): boolean =>
    !!baseline && baseline !== group && typographyComparable(group, field) !== typographyComparable(baseline, field);
  const piece = (value: string, isChanged: boolean, isOverride = false): string => {
    const classes = [isChanged || isOverride ? "type-changed" : "", isOverride ? "type-override" : ""]
      .filter(Boolean)
      .join(" ");
    const title = isOverride ? ` title="Changed from ${escapeHtml(group.token ?? "token")} default"` : "";
    return `<span${classes ? ` class="${classes}"` : ""}${title}>${escapeHtml(value)}</span>`;
  };
  const type = group.typography;
  const size = `${typographyValue(group, "size")}${type.lineHeight === undefined ? "" : `/${+type.lineHeight}`}`;
  const sizeChanged = changed("size") || changed("lineHeight");
  const sizeOverridden = overridden("size") || overridden("lineHeight");
  const settings = [
    piece(typographyValue(group, "token"), changed("token"), overridden("token")),
    piece(typographyValue(group, "family"), changed("family"), overridden("family")),
    piece(`wght ${typographyValue(group, "weight")}`, changed("weight"), overridden("weight")),
    piece(size, sizeChanged, sizeOverridden),
    ...(type.letterSpacing === undefined
      ? []
      : [piece(`tracking ${+type.letterSpacing}`, changed("tracking"), overridden("tracking"))]),
    ...(type.fontStyle && type.fontStyle !== "normal"
      ? [piece(type.fontStyle, changed("style"), overridden("style"))]
      : []),
  ];
  const count = group ? `${group.nodes.length} ${group.nodes.length === 1 ? "usage" : "usages"}` : "No matching usage";
  return `<span class="type-inline"><span class="type-side">${side}</span> · ${settings.join(" · ")} · <span class="type-count">${count}</span></span>`;
}

function typographyComparisonMarkup(comparison: TypographyComparison): string {
  if (comparison.pairs.length === 0) return "";
  const rows = comparison.pairs
    .map((pair) => {
      return `<article class="type-group" data-type-row="${escapeHtml(pair.marker)}" tabindex="0">
                <span class="type-marker">${escapeHtml(pair.marker)}</span>
                ${typographyInline("Reference", pair.reference, pair.candidate,
                  pair.reference?.token ? comparison.referenceDefaults.get(pair.reference.token) : undefined)}
                <span class="type-arrow" aria-hidden="true">→</span>
                ${typographyInline("Candidate", pair.candidate, pair.reference,
                  pair.candidate?.token ? comparison.candidateDefaults.get(pair.candidate.token) : undefined)}
              </article>`;
    })
    .join("");
  return `<section class="type-summary" data-summary-layer="typography" aria-label="Typography style comparison">
            <h4>Typography styles</h4>
            <div class="type-groups">${rows}</div>
          </section>`;
}

/** Scale a node's geometry by a uniform factor — bounds only. Type sizes are
 *  already density-independent (sp) and radius/padding already in dp, so only the
 *  px bounds need converting. */
function scaleNode(n: SemanticNode, s: number): SemanticNode {
  const b = n.bounds;
  return {
    ...n,
    ...(b ? { bounds: { x: b.x * s, y: b.y * s, width: b.width * s, height: b.height * s } } : {}),
    ...(n.children ? { children: n.children.map((c) => scaleNode(c, s)) } : {}),
  };
}

/**
 * Put the candidate tree in the reference's bounds space for display. The
 * candidate's `boundsInRoot` are device pixels (e.g. a 411dp screen renders at
 * 1078px), so its box-model readouts came out ~density× the reference's boxes.
 * Apply the same uniform frame-width scale the layout diff already uses
 * ({@link diffLayout}) so both panels measure in one space. No-op on the geometry
 * when either side lacks a root frame (assume a shared space).
 *
 * That space is the *reference's*, so a tree that reaches it carries the
 * reference's `boundsDensity` — its own no longer describes boxes it no longer
 * holds. Both halves of that matter: an unscaled reference states none, and the
 * candidate's 2.625 surviving the move would have the overlay divide dp boxes by
 * a device density and print a third of the truth; a scaled board states one, and
 * it is the factor that turns these rescaled boxes back into dp. The path that
 * cannot scale is the exception — an untransformed tree is still in its own
 * space, and keeps the factor that describes it.
 */
export function toDisplayFrame(
  cand: SemanticTree | undefined,
  ref: SemanticTree | undefined,
): SemanticTree | undefined {
  if (!cand) return cand;
  if (!ref) return cand;
  const inRefSpace = (t: SemanticTree): SemanticTree => {
    if (t.boundsDensity === ref.boundsDensity) return t;
    const { boundsDensity: _own, ...rest } = t;
    return ref.boundsDensity === undefined ? rest : { ...rest, boundsDensity: ref.boundsDensity };
  };
  const cw = cand.root.bounds?.width;
  const rw = ref.root.bounds?.width;
  // Nothing to scale by, so nothing moved: the candidate keeps its own boxes
  // *and* its own factor. Handing it the reference's here would have the overlay
  // divide untouched device pixels by a density that never applied to them.
  if (!cw || !rw) return cand;
  const s = rw / cw;
  if (Math.abs(s - 1) < 1e-6) return inRefSpace(cand);
  return { ...inRefSpace(cand), root: scaleNode(cand.root, s) };
}

/** Toggle bar for the per-panel annotation layers (box model, typography, layout). */
function annotationControls(hasLayout: boolean): string {
  const layoutToggle = hasLayout
    ? `\n            <label class="anno-toggle"><input type="checkbox" data-anno-layer="layout" /> Layout deltas</label>`
    : "";
  return `<div class="anno-controls">
            <span class="anno-controls-label">Annotations</span>
            <label class="anno-toggle"><input type="checkbox" data-anno-layer="spacing" /> Box model (size · padding · radius)</label>
            <label class="anno-toggle"><input type="checkbox" data-anno-layer="typography" /> Typography</label>${layoutToggle}
          </div>`;
}

/** The structural layout diff's per-element geometry findings, for the layout layer. */
function layoutDeltas(verdict: Verdict): LayoutDelta[] {
  const out: LayoutDelta[] = [];
  for (const f of verdict.findings) {
    if (f.kind !== "layout" || !f.detail) continue;
    const { label, dx, dy, dw, dh } = f.detail as Record<string, unknown>;
    if (
      typeof label === "string" &&
      typeof dx === "number" &&
      typeof dy === "number" &&
      typeof dw === "number" &&
      typeof dh === "number"
    ) {
      out.push({ label, dx, dy, dw, dh });
    }
  }
  return out;
}

function variantMarkup(
  variant: Variant,
  index: number,
  refSrc: string | undefined,
  candSrc: string | undefined,
  diffSrc: string | undefined,
  refTree: SemanticTree | undefined,
  candTree: SemanticTree | undefined,
  deltas: readonly LayoutDelta[],
  controls: string,
  typography: TypographyComparison,
): string {
  const meta = [variant.state, variant.theme, variant.size]
    .filter(Boolean)
    .map((v) => `<span class="chip">${escapeHtml(String(v))}</span>`)
    .join(" ");

  const ref: Panel = { label: "Reference", src: refSrc };
  const cand: Panel = { label: "Candidate", src: candSrc };
  const diff: Panel = { label: "Diff", src: diffSrc };

  // One view at a time, picked by a per-variant mode selector, so the three
  // overlapping mechanisms (static diff panel + wipe slider + always-on labels)
  // no longer all show at once. Side-by-side is the default — nothing annotated,
  // no heatmap, no slider — until the reader opts into a mode.
  const hasDiff = !!diffSrc;
  const hasSlider = !!(refSrc && candSrc);

  const sideView = `<div class="view pair" data-view-panel="${index}" data-view-value="side">
              ${panelMarkup(ref, "reference", refTree, deltas, { typographyMarkers: typography.referenceMarkers })}
              ${panelMarkup(cand, "candidate", candTree, deltas, { typographyMarkers: typography.candidateMarkers })}
            </div>`;

  // Differences: the pixel heatmap, with the layout-delta boxes available under
  // the Layout toggle (they no longer draw unprompted).
  const diffView = hasDiff
    ? `<div class="view diff-view" data-view-panel="${index}" data-view-value="diff" hidden>
              ${panelMarkup(diff, "diff", candTree, deltas, { diff: true })}
            </div>`
    : "";

  // Slider: reference stacked under candidate, wiped by an opacity slider. Shown
  // only in this mode, never alongside the diff heatmap.
  const sliderView = hasSlider
    ? `<div class="view slider-view" data-view-panel="${index}" data-view-value="slider" hidden>
              <div class="overlay">
                <div class="overlay-stack">
                  <img class="overlay-ref" src="${refSrc}" alt="reference" />
                  <img class="overlay-cand" src="${candSrc}" alt="candidate" data-overlay="${index}" />
                </div>
                <label class="overlay-control">
                  <span>reference</span>
                  <input type="range" min="0" max="100" value="100" data-slider="${index}" />
                  <span>candidate</span>
                </label>
              </div>
            </div>`
    : "";

  // The mode selector, offered only when there's more than one view to pick from.
  const modes: { v: string; l: string }[] = [{ v: "side", l: "Side by side" }];
  if (hasDiff) modes.push({ v: "diff", l: "Differences" });
  if (hasSlider) modes.push({ v: "slider", l: "Slider" });
  const modeSelect =
    modes.length > 1
      ? `<div class="mode-select" role="group" aria-label="View mode">${modes
          .map(
            (m, i) =>
              `<label class="mode-toggle"><input type="radio" name="view-${index}" value="${m.v}" data-view="${index}"${i === 0 ? " checked" : ""} /> ${escapeHtml(m.l)}</label>`,
          )
          .join("")}</div>`
      : "";

  // Mode selector + annotation-layer toggles share one control bar above the view.
  const viewControls =
    modeSelect || controls ? `<div class="view-controls">${modeSelect}${controls}</div>` : "";

  return `<section class="variant" id="${variantId(variant.key)}" data-variant="${escapeHtml(variant.key)}">
            <header class="variant-head">
              <h3>${escapeHtml(variant.key)}</h3>
              <div class="variant-meta">${meta}</div>
            </header>
            ${viewControls}
            <div class="views">
              ${sideView}
              ${diffView}
              ${sliderView}
            </div>
            ${typographyComparisonMarkup(typography)}
          </section>`;
}

/**
 * What the reference render depicts, as a chip row under the subtitle.
 *
 * The reference is the component at one point in its property space, and the
 * source picks that point from its own defaults — a `Show icon` the variant
 * name never mentions still shows an icon in the picture. A reviewer comparing
 * two images has no way to know that from the images. Non-variant properties
 * are highlighted because those are the silent ones; variant axes are already
 * spelled out in the variant key above each comparison.
 */
function depictsMarkup(properties: readonly ReferenceProperty[] | undefined): string {
  if (!properties || properties.length === 0) return "";
  const chips = properties
    .map((p) => {
      const cls = p.type === "variant" ? "chip" : "chip chip-default";
      return `<span class="${cls}">${escapeHtml(p.name)}=${escapeHtml(p.value)}</span>`;
    })
    .join("");
  return `\n  <div class="depicts">Reference depicts ${chips}</div>`;
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
.depicts{margin-top:8px;color:#9a9ab0;font-size:12px}
.depicts .chip{margin:0 4px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.depicts .chip-default{background:#2b2418;color:#e8c66b}
.status{display:inline-block;margin-left:10px;padding:2px 10px;border-radius:999px;font-weight:600;font-size:12px;vertical-align:middle}
.status-pass{background:#16351f;color:#7ee29a}
.status-warn{background:#3a3115;color:#e8c66b}
.status-fail{background:#3a1820;color:#f08a9c}
main{padding:20px 28px;display:grid;gap:24px;max-width:1200px}
.variant{border:1px solid #26262f;border-radius:10px;padding:16px;background:#15151c}
.variant-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.variant-head h3{margin:0;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.chip{display:inline-block;padding:1px 8px;border-radius:6px;background:#222230;color:#b8b8cc;font-size:11px;margin-left:4px}
.section-title{margin:0 0 -8px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#9a9ab0}
.matrix-wrap{overflow-x:auto;border:1px solid #26262f;border-radius:10px;background:#15151c}
table.matrix{border-collapse:collapse;width:100%}
table.matrix th,table.matrix td{padding:10px;border-bottom:1px solid #26262f;text-align:center;vertical-align:middle}
table.matrix th+th,table.matrix td{border-left:1px solid #26262f}
table.matrix tbody tr:last-child th,table.matrix tbody tr:last-child td{border-bottom:none}
table.matrix thead th{background:#191921;color:#9a9ab0;font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
th.matrix-corner{text-align:left;color:#9a9ab0;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
th.matrix-row{text-align:left;white-space:nowrap;background:#13131a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9c9dd;font-weight:600}
.matrix-cell{background:#0c0c11}
.matrix-link{display:inline-block;line-height:0}
.matrix-img{display:block;max-width:220px;max-height:200px;width:auto;height:auto;margin:0 auto;border-radius:6px;image-rendering:pixelated}
.view-controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:12px}
.mode-select{display:inline-flex;gap:2px;background:#0c0c11;border:1px solid #26262f;border-radius:8px;padding:3px}
.mode-toggle{display:inline-flex;align-items:center;gap:6px;color:#9a9ab0;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:6px}
.mode-toggle:has(input:checked){background:#222230;color:#fff}
.mode-toggle input{position:absolute;width:1px;height:1px;opacity:0;margin:0}
.pair{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.diff-view,.slider-view{display:flex;justify-content:center}
.views .view[hidden]{display:none}
.diff-view .panel{max-width:360px}
.panel{margin:0;border:1px solid #26262f;border-radius:8px;overflow:hidden;background:#0c0c11}
.panel figcaption{padding:6px 10px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#9a9ab0;border-bottom:1px solid #26262f}
.panel-body{display:flex;align-items:center;justify-content:center;min-height:64px;padding:10px}
.panel-img{max-width:100%;height:auto;image-rendering:pixelated}
.matrix-img.is-vector,.panel-img.is-vector{image-rendering:auto}
.panel-empty{color:#666;font-size:12px;padding:20px}
.panel-figure{position:relative;display:inline-block;line-height:0;max-width:100%}
.panel-figure .panel-img{display:block}
.anno{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.anno g[data-layer]{display:none}
.anno g[data-layer].on{display:inline}
.anno-type-hit{fill:transparent}.anno-type.active>rect{fill-opacity:.2}.anno-type-hit.active{fill:#9f85ff;fill-opacity:.28;stroke:#9f85ff;stroke-width:1}
.anno-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.anno-controls-label{color:#9a9ab0;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
.anno-toggle{display:flex;align-items:center;gap:6px;color:#c9c9dd;font-size:13px;cursor:pointer}
.type-summary{display:none;margin-top:12px}
.type-summary.on{display:block}
.type-summary h4{margin:0 0 8px;color:#9a9ab0;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
.type-groups{display:grid;gap:6px;overflow-x:auto}
.type-group{display:flex;align-items:center;gap:9px;min-width:max-content;padding:7px 10px;border:1px solid #30303b;border-radius:8px;background:#111118}
.type-group:hover,.type-group:focus-visible{border-color:#7c5ce7;background:#19152a;outline:none}
.type-marker{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#6941c6;color:#fff;font-size:10px;font-weight:700}
.type-inline{color:#e7e7ef;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.type-side{color:#9a9ab0;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.type-changed{color:#f08a9c;font-weight:650}
.type-override{text-decoration:underline 2px rgba(240,138,156,.55);text-underline-offset:2px}
.type-count{color:#77778d;font-size:11px}.type-arrow{color:#9a9ab0}
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
@media (max-width:760px){.pair{grid-template-columns:1fr}}`;

const SCRIPT = `(function(){
  var modes=document.querySelectorAll('input[data-view]');
  for(var m=0;m<modes.length;m++){
    (function(radio){
      var id=radio.getAttribute('data-view');
      var scope=radio.closest('.variant')||document;
      function apply(){
        if(!radio.checked) return;
        var views=scope.querySelectorAll('[data-view-panel="'+id+'"]');
        for(var k=0;k<views.length;k++){
          views[k].hidden=(views[k].getAttribute('data-view-value')!==radio.value);
        }
      }
      radio.addEventListener('change',apply);
      apply();
    })(modes[m]);
  }
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
  var toggles=document.querySelectorAll('input[data-anno-layer]');
  for(var j=0;j<toggles.length;j++){
    (function(box){
      var layer=box.getAttribute('data-anno-layer');
      var scope=box.closest('.variant')||document;
      function apply(){
        var gs=scope.querySelectorAll('.anno g[data-layer="'+layer+'"],[data-summary-layer="'+layer+'"]');
        for(var k=0;k<gs.length;k++){ gs[k].classList[box.checked?'add':'remove']('on'); }
      }
      box.addEventListener('change',apply);
      apply();
    })(toggles[j]);
  }
  var typeRows=document.querySelectorAll('[data-type-row]');
  for(var r=0;r<typeRows.length;r++){
    (function(row){
      var marker=row.getAttribute('data-type-row');
      var scope=row.closest('.variant')||document;
      function active(on){
        var nodes=scope.querySelectorAll('[data-type-marker="'+marker+'"]');
        for(var n=0;n<nodes.length;n++){nodes[n].classList[on?'add':'remove']('active');}
      }
      row.addEventListener('mouseenter',function(){active(true);});
      row.addEventListener('mouseleave',function(){active(false);});
      row.addEventListener('focus',function(){active(true);});
      row.addEventListener('blur',function(){active(false);});
    })(typeRows[r]);
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

  // Inline each variant's images once, then reuse for both the candidate matrix
  // (overview) and the per-variant reference|candidate|diff detail below.
  const rendered: Rendered[] = variants.map((variant, index) => {
    const refSrc = inlineFromDisk(root, variant.reference);
    const candSrc = inlineFromDisk(root, variant.candidate);
    const diff = diffByKey.get(variant.key);
    const diffSrc = diff ? pngDataUri(diff.png) : undefined;
    return { variant, index, refSrc, candSrc, diffSrc };
  });

  // One semantic tree per side for the whole component (geometry is theme-
  // invariant), reused across every variant's candidate/reference panel.
  // Tokens in code units (dp/sp) once, at the entry, so no reader downstream has
  // to know a board's density — and a scaled reference stops quoting raw board
  // pixels as `sp` beside a verdict that already converted them (issue #379).
  const refTree = inCodeUnits(reference.layout);
  // Display the candidate in the reference's bounds space so box-model readouts
  // measure the same thing on both sides (its raw bounds are device px). The
  // diff already does this internally; this is the matching fix for the overlay.
  const candTree = toDisplayFrame(inCodeUnits(candidate.semantics), refTree);
  const deltas = layoutDeltas(verdict);
  const typography = compareTypography(refTree, candTree);

  const hasVariants = rendered.length > 0;
  // Show the annotation toggles only when at least one panel can draw them. They
  // sit *inside* each variant — between its triptych and the overlay slider — so
  // the controls for a comparison are right where you're looking (scoped per
  // variant by the toggle script).
  const hasAnnotations =
    !!annotationSvg(candTree, deltas, { typographyMarkers: typography.candidateMarkers }) ||
    !!annotationSvg(refTree, deltas, { typographyMarkers: typography.referenceMarkers });
  const controls = hasAnnotations ? annotationControls(deltas.length > 0) : "";

  const detailsHtml = rendered
    .map((r) =>
      variantMarkup(r.variant, r.index, r.refSrc, r.candSrc, r.diffSrc, refTree, candTree, deltas, controls, typography),
    )
    .join("\n");

  const variantsSection = hasVariants
    ? `${matrixMarkup(rendered)}
<h2 class="section-title">Variant detail</h2>
${detailsHtml}`
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
  <div class="subtitle">${escapeHtml(reference.source)} reference vs candidate render</div>${depictsMarkup(reference.properties)}
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
