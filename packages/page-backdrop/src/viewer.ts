/**
 * The viewer: one self-contained HTML page showing each imported design page as
 * a **backdrop**, every component instance as a linked hotspot on top of it,
 * and — when the caller supplies renders — the code's own output laid over the
 * design.
 *
 * Self-contained in the same sense as `@design-parity/report-html`: images are
 * inlined as `data:` URIs and the CSS/JS is inline, so the file opens from a
 * PR artifact, a `file://` path, or an offline laptop with nothing to fetch.
 *
 * ## What starts on
 *
 * Hotspots start **on** — they are the point of the page. The overlay starts
 * **off** unless the config says otherwise: the first thing you should see is
 * the design as designed, with code laid over it only once you ask. The layer
 * is always built into the page, so the toggle works with no network.
 *
 * ## How the overlay is anchored
 *
 * A render is pinned to its placement's **top-left corner and scaled to the
 * placement's width**, keeping its own aspect ratio. It deliberately does not
 * stretch to fill the box: a component that renders taller than its design slot
 * is a real finding, and stretching would hide exactly that drift. So an
 * overflowing overlay means the heights disagree — read it, don't fix it in
 * CSS.
 */
import type { OverlayConfig } from "./config.js";
import { escapeHtml, pct, pngDataUri } from "./html.js";
import type { BackdropPage, PageBackdropManifest, Placement } from "./types.js";

export interface ViewerOptions {
  manifest: PageBackdropManifest;
  /** Backdrop PNG bytes, keyed by page id. A page with none renders its hotspots on an empty frame. */
  backdrops: Map<string, Uint8Array>;
  /**
   * Candidate render PNG bytes, keyed by code handle. Supplied by the caller —
   * this package never renders — so the overlay works with whatever produced
   * them (`compose-preview`, a committed baseline, anything).
   */
  renders?: Map<string, Uint8Array>;
  /** Code handle → a URL to open for it (a source file, a preview, an issue). */
  sourceUrls?: Map<string, string>;
  /** Viewer defaults. Omitted means overlay off, 0.5 opacity, normal blend. */
  overlay?: OverlayConfig;
  /** Page title. Defaults to the manifest's file key. */
  title?: string;
}

const DEFAULT_OVERLAY: OverlayConfig = { enabled: false, opacity: 0.5, blend: "normal" };

/** Human label for a placement's link method. */
function linkLabel(link: Placement["link"]): string {
  switch (link) {
    case "code-connect":
      return "Code Connect";
    case "manifest":
      return "design-map";
    case "convention":
      return "name match";
    case "unlinked":
      return "unlinked";
  }
}

/** A stable DOM id for a placement — node ids contain `:`, which selectors hate. */
function spotId(pageId: string, placement: Placement): string {
  return `spot-${pageId}-${placement.nodeId.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

function renderSpot(
  page: BackdropPage,
  placement: Placement,
  renders: Map<string, Uint8Array> | undefined,
  seenRenders: Map<string, string>,
): string {
  const { bounds } = placement;
  const style = [
    `left:${pct(bounds.x, page.frame.width)}`,
    `top:${pct(bounds.y, page.frame.height)}`,
    `width:${pct(bounds.width, page.frame.width)}`,
    `height:${pct(bounds.height, page.frame.height)}`,
  ].join(";");

  const label = placement.code ?? placement.name;

  // Inline each distinct render once, however many placements reuse it — a
  // component that appears six times on a screen must not inline six copies.
  let overlay = "";
  const code = placement.code;
  if (code && renders?.has(code)) {
    let uri = seenRenders.get(code);
    if (uri === undefined) {
      uri = pngDataUri(renders.get(code)!);
      seenRenders.set(code, uri);
    }
    overlay = `<img class="spot-render" src="${uri}" alt="" aria-hidden="true">`;
  }

  return (
    `<div class="spot" id="${spotId(page.id, placement)}" style="${style}"` +
    ` data-link="${placement.link}" data-code="${escapeHtml(placement.code ?? "")}"` +
    ` tabindex="0" role="button" aria-label="${escapeHtml(`${placement.name} — ${linkLabel(placement.link)}`)}">` +
    overlay +
    `<span class="spot-label">${escapeHtml(label)}</span>` +
    `</div>`
  );
}

function renderLegendRow(
  page: BackdropPage,
  placement: Placement,
  sourceUrls: Map<string, string> | undefined,
  hasRender: boolean,
): string {
  const code = placement.code;
  const url = code ? sourceUrls?.get(code) : undefined;
  const codeCell = code
    ? url
      ? `<a class="mono" href="${escapeHtml(url)}">${escapeHtml(code)}</a>`
      : `<span class="mono">${escapeHtml(code)}</span>`
    : `<span class="muted">no code component</span>`;

  const chips = [`<span class="chip chip-${placement.link}">${linkLabel(placement.link)}</span>`];
  if (hasRender) chips.push(`<span class="chip chip-render">render</span>`);
  if (placement.depth > 0) chips.push(`<span class="chip">nested ${placement.depth}</span>`);

  return (
    `<li class="legend-row" data-link="${placement.link}" data-target="${spotId(page.id, placement)}">` +
    `<button class="legend-hit" type="button">${escapeHtml(placement.name)}</button>` +
    `<div class="legend-meta">${codeCell} ${chips.join(" ")}</div>` +
    `</li>`
  );
}

function renderPage(
  page: BackdropPage,
  index: number,
  opts: ViewerOptions,
  seenRenders: Map<string, string>,
): string {
  const png = opts.backdrops.get(page.id);
  const backdrop = png
    ? `<img class="backdrop" src="${pngDataUri(png)}" alt="${escapeHtml(page.name)}">`
    : `<div class="backdrop backdrop-missing">backdrop image not supplied</div>`;

  const spots = page.placements
    .map((p) => renderSpot(page, p, opts.renders, seenRenders))
    .join("");
  const rows = page.placements
    .map((p) =>
      renderLegendRow(page, p, opts.sourceUrls, !!(p.code && opts.renders?.has(p.code))),
    )
    .join("");

  const linked = page.placements.filter((p) => p.link !== "unlinked").length;
  const total = page.placements.length;

  return (
    `<section class="page" data-page="${escapeHtml(page.id)}"${index === 0 ? "" : " hidden"}>` +
    `<div class="page-body">` +
    `<div class="stage-wrap">` +
    `<div class="stage" style="aspect-ratio:${page.frame.width} / ${page.frame.height}">` +
    backdrop +
    `<div class="spots">${spots}</div>` +
    `</div>` +
    `</div>` +
    `<aside class="legend">` +
    `<h2>${escapeHtml(page.name)}</h2>` +
    `<p class="muted">${linked} of ${total} instances linked to code · frame ${page.frame.width}×${page.frame.height}</p>` +
    `<ol class="legend-list">${rows}</ol>` +
    `</aside>` +
    `</div>` +
    `</section>`
  );
}

const STYLE = `:root{color-scheme:light dark;--overlay-opacity:0;--overlay-blend:normal}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0f14;color:#e7e7ef}
a{color:#9db8ff}
header.page-head{padding:20px 28px;border-bottom:1px solid #26262f}
header.page-head h1{margin:0 0 4px;font-size:18px}
.subtitle{color:#9a9ab0;font-size:13px}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin:14px 0 0}
.tab{padding:5px 12px;border-radius:8px;border:1px solid #26262f;background:#15151c;color:#c9c9dd;font-size:13px;cursor:pointer}
.tab[aria-selected="true"]{background:#222230;color:#fff;border-color:#3a3a4a}
.controls{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:#9a9ab0}
.controls label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.controls input[type=range]{width:120px;accent-color:#7ea6ff}
.controls select{background:#15151c;color:#e7e7ef;border:1px solid #26262f;border-radius:6px;padding:3px 6px}
main{padding:20px 28px}
.page-body{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
@media (max-width:900px){.page-body{grid-template-columns:minmax(0,1fr)}}
.stage-wrap{background:#0c0c11;border:1px solid #26262f;border-radius:10px;padding:12px}
.stage{position:relative;width:100%;overflow:hidden;background:#15151c;border-radius:6px}
.backdrop{display:block;width:100%;height:100%;object-fit:contain}
.backdrop-missing{display:flex;align-items:center;justify-content:center;height:100%;color:#6e6e86;font-size:12px}
.spots{position:absolute;inset:0}
.spot{position:absolute;border:1px solid transparent;border-radius:3px;cursor:pointer}
.spot-label{position:absolute;left:0;top:100%;margin-top:2px;padding:1px 6px;border-radius:4px;background:#1c1c26;color:#c9c9dd;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s}
.spot:hover .spot-label,.spot:focus .spot-label,.spot.active .spot-label{opacity:1}
.spot-render{position:absolute;left:0;top:0;width:100%;height:auto;opacity:var(--overlay-opacity);mix-blend-mode:var(--overlay-blend);pointer-events:none;image-rendering:pixelated}
body.hotspots .spot[data-link="code-connect"]{border-color:#4ea87a;background:rgba(78,168,122,.10)}
body.hotspots .spot[data-link="manifest"]{border-color:#7ea6ff;background:rgba(126,166,255,.10)}
body.hotspots .spot[data-link="convention"]{border-color:#e8c66b;background:rgba(232,198,107,.10)}
body.hotspots .spot[data-link="unlinked"]{border-color:#f08a9c;background:rgba(240,138,156,.10);border-style:dashed}
.spot.active{outline:2px solid #fff;outline-offset:1px}
body.only-unlinked .spot:not([data-link="unlinked"]),body.only-unlinked .legend-row:not([data-link="unlinked"]){display:none}
.legend h2{margin:0 0 2px;font-size:15px}
.legend-list{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.legend-row{border:1px solid #26262f;border-left-width:3px;border-radius:8px;padding:8px 10px;background:#15151c}
.legend-row[data-link="code-connect"]{border-left-color:#4ea87a}
.legend-row[data-link="manifest"]{border-left-color:#7ea6ff}
.legend-row[data-link="convention"]{border-left-color:#e8c66b}
.legend-row[data-link="unlinked"]{border-left-color:#f08a9c}
.legend-row.active{background:#1c1c26;border-color:#3a3a4a}
.legend-hit{display:block;width:100%;text-align:left;background:none;border:0;padding:0;color:#e7e7ef;font:inherit;font-weight:600;cursor:pointer}
.legend-meta{margin-top:3px;font-size:11px;color:#9a9ab0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.muted{color:#6e6e86}
.chip{display:inline-block;padding:1px 7px;border-radius:6px;background:#222230;color:#b8b8cc;font-size:10px}
.chip-code-connect{background:#16351f;color:#7ee29a}
.chip-manifest{background:#1a2440;color:#9db8ff}
.chip-convention{background:#3a3115;color:#e8c66b}
.chip-unlinked{background:#3a1820;color:#f08a9c}
.chip-render{background:#2a2140;color:#c3a6ff}
.page[hidden]{display:none}`;

const SCRIPT = `(function(){
  var body=document.body;
  var root=document.documentElement;
  function bind(id,fn){var el=document.getElementById(id);if(el)el.addEventListener('change',function(){fn(el)});return el}
  bind('t-hotspots',function(el){body.classList.toggle('hotspots',el.checked)});
  var op=document.getElementById('t-opacity');
  var ov=bind('t-overlay',function(el){apply()});
  function apply(){
    var on=ov?ov.checked:false;
    root.style.setProperty('--overlay-opacity',on?String(Number(op.value)/100):'0');
    if(op)op.disabled=!on;
  }
  if(op)op.addEventListener('input',apply);
  bind('t-blend',function(el){root.style.setProperty('--overlay-blend',el.value)});
  bind('t-unlinked',function(el){body.classList.toggle('only-unlinked',el.checked)});
  apply();

  var tabs=[].slice.call(document.querySelectorAll('.tab'));
  tabs.forEach(function(tab){tab.addEventListener('click',function(){
    tabs.forEach(function(t){t.setAttribute('aria-selected',String(t===tab))});
    [].forEach.call(document.querySelectorAll('.page'),function(p){
      p.hidden=p.getAttribute('data-page')!==tab.getAttribute('data-page');
    });
  })});

  function select(spot,row){
    [].forEach.call(document.querySelectorAll('.active'),function(e){e.classList.remove('active')});
    if(spot)spot.classList.add('active');
    if(row)row.classList.add('active');
  }
  [].forEach.call(document.querySelectorAll('.legend-row'),function(row){
    row.querySelector('.legend-hit').addEventListener('click',function(){
      var spot=document.getElementById(row.getAttribute('data-target'));
      select(spot,row);
      if(spot)spot.scrollIntoView({block:'nearest',inline:'nearest'});
    });
  });
  [].forEach.call(document.querySelectorAll('.spot'),function(spot){
    function hit(){
      var row=document.querySelector('.legend-row[data-target="'+spot.id+'"]');
      select(spot,row);
      if(row)row.scrollIntoView({block:'nearest'});
    }
    spot.addEventListener('click',hit);
    spot.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();hit()}});
  });
})();`;

/**
 * Render the whole viewer to one HTML string.
 *
 * Deterministic: page and placement order come straight from the manifest, and
 * nothing timestamps the output — re-running over an unchanged manifest gives a
 * byte-identical file.
 */
export function renderPageBackdropHtml(opts: ViewerOptions): string {
  const overlay = opts.overlay ?? DEFAULT_OVERLAY;
  const { manifest } = opts;
  const title = opts.title ?? `Design pages — ${manifest.fileKey}`;

  const seenRenders = new Map<string, string>();
  const pages = manifest.pages
    .map((page, i) => renderPage(page, i, opts, seenRenders))
    .join("");

  const tabs =
    manifest.pages.length > 1
      ? `<div class="tabs" role="tablist">${manifest.pages
          .map(
            (p, i) =>
              `<button class="tab" role="tab" type="button" data-page="${escapeHtml(p.id)}" aria-selected="${i === 0}">${escapeHtml(p.name)}</button>`,
          )
          .join("")}</div>`
      : "";

  const totals = manifest.pages.reduce(
    (acc, p) => {
      acc.total += p.placements.length;
      acc.linked += p.placements.filter((x) => x.link !== "unlinked").length;
      return acc;
    },
    { total: 0, linked: 0 },
  );

  const opacityPct = Math.round(overlay.opacity * 100);
  const controls =
    `<div class="controls">` +
    `<label><input type="checkbox" id="t-hotspots" checked> Hotspots</label>` +
    `<label><input type="checkbox" id="t-overlay"${overlay.enabled ? " checked" : ""}> Show renders on top</label>` +
    `<label>Opacity <input type="range" id="t-opacity" min="0" max="100" value="${opacityPct}"></label>` +
    `<label>Blend <select id="t-blend">` +
    `<option value="normal"${overlay.blend === "normal" ? " selected" : ""}>normal</option>` +
    `<option value="difference"${overlay.blend === "difference" ? " selected" : ""}>difference</option>` +
    `</select></label>` +
    `<label><input type="checkbox" id="t-unlinked"> Only unlinked</label>` +
    `</div>`;

  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body class="hotspots">` +
    `<header class="page-head"><h1>${escapeHtml(title)}</h1>` +
    `<p class="subtitle">${manifest.pages.length} page${manifest.pages.length === 1 ? "" : "s"} · ` +
    `${totals.linked} of ${totals.total} component instances linked to code · Figma file <span class="mono">${escapeHtml(manifest.fileKey)}</span></p>` +
    tabs +
    controls +
    `</header><main>${pages}</main><script>${SCRIPT}</script></body></html>\n`
  );
}
