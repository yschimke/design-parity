/**
 * Annotation overlays for the report's panels.
 *
 * Design tools (Figma Dev Mode, Zeplin, browser DevTools) surface fine spec
 * detail as *toggleable layers* drawn over the artwork, in the artwork's own
 * coordinate space. This builds the same as an inline `<svg>` per panel, driven
 * by the panel's {@link SemanticTree} (the candidate's render semantics, or the
 * reference's captured layout):
 *
 * - **box model** — each element's bounding box, its `W×H`, and (when the node
 *   carries them) its corner radius and padding, the latter shaded like a
 *   DevTools padding ring. Boxes/sizes come from bounds, captured on both sides;
 *   radius/padding render when present (a hand-authored or token-rich candidate
 *   node has them; the daemon's geometry and the reference's geometry-only
 *   capture don't yet, so they degrade to box + size).
 * - **typography** — per text node, a callout with `family · size · weight`
 *   (line-height when present) and the resolved text colour. Candidate-side
 *   today; the reference capture is geometry-only.
 * - **layout** — elements the structural layout diff flagged as shifted/resized,
 *   highlighted with their position/size drift read out. Driven by the verdict's
 *   `layout` findings, matched to a node by label.
 *
 * The SVG's `viewBox` is the tree's own frame (`root.bounds` — candidate device
 * pixels, reference dp), so when it's stretched over the panel image both scale
 * together and annotations stay pinned with no pixel-density maths. Label text
 * and stroke widths are sized as a fraction of the frame width so they read the
 * same whether the frame is ~1080px (candidate) or ~411dp (reference). Output is
 * deterministic — coordinates are rounded, order follows the tree.
 */
import type {
  Bounds,
  SemanticNode,
  SemanticTree,
  TypographyToken,
} from "@design-parity/core";

import { escapeHtml } from "./html.js";

/** A bounded element pulled from a tree, with whatever spec it carries. */
interface Placed {
  label?: string;
  role?: string;
  bounds: Bounds;
  typography?: TypographyToken;
  /** Resolved text colour (the node's foreground), when known. */
  color?: string;
  /** Uniform padding (single value), when the node declares it. */
  padding?: number;
  /** Corner radius, when the node declares it. */
  radius?: number;
}

/** Round to 1dp for compact, stable SVG coordinates. */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}

/** First value of a string-keyed token map, regardless of its key. */
function first<T>(map: Record<string, T> | undefined): T | undefined {
  if (!map) return undefined;
  for (const k of Object.keys(map)) return map[k];
  return undefined;
}

/** Flatten a tree to its bounded nodes, carrying type/colour/padding/radius. */
function flatten(tree: SemanticTree): Placed[] {
  const out: Placed[] = [];
  const visit = (n: SemanticNode): void => {
    if (n.bounds) {
      const typography = first(n.tokens?.typography);
      // The daemon records foreground before background, so the first colour is
      // the text's own (insertion order is preserved).
      const colors = n.tokens?.colors ? Object.values(n.tokens.colors) : [];
      const padding = n.tokens?.spacing?.["padding"];
      const radius = first(n.tokens?.radius);
      out.push({
        ...(n.label !== undefined ? { label: n.label } : {}),
        ...(n.role ? { role: n.role } : {}),
        bounds: n.bounds,
        ...(typography ? { typography } : {}),
        ...(colors[0] ? { color: colors[0] } : {}),
        ...(typeof padding === "number" ? { padding } : {}),
        ...(typeof radius === "number" ? { radius } : {}),
      });
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(tree.root);
  return out;
}

/** Bounding box over a set of placed elements (frame fallback). */
function bbox(nodes: Placed[]): Bounds | undefined {
  if (nodes.length === 0) return undefined;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.bounds.x);
    minY = Math.min(minY, n.bounds.y);
    maxX = Math.max(maxX, n.bounds.x + n.bounds.width);
    maxY = Math.max(maxY, n.bounds.y + n.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A small labelled tag (rounded rect + monospace text) at `(x, y)`. */
function tag(x: number, y: number, text: string, u: number, fill: string, ink: string): string {
  const fs = 2.6 * u;
  const pad = 0.7 * u;
  const w = text.length * fs * 0.62 + pad * 2;
  const h = fs + pad * 2;
  return (
    `<g transform="translate(${r(x)},${r(y)})">` +
    `<rect width="${r(w)}" height="${r(h)}" rx="${r(0.5 * u)}" fill="${fill}" fill-opacity="0.92"/>` +
    `<text x="${r(pad)}" y="${r(pad + fs * 0.82)}" font-size="${r(fs)}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="${ink}">${escapeHtml(text)}</text>` +
    `</g>`
  );
}

/** Box + radius + padding + dimension tag for one element (the box-model layer). */
function boxMark(n: Placed, u: number): string {
  const { x, y, width, height } = n.bounds;
  const stroke = 0.3 * u;
  const rx = n.radius !== undefined ? Math.min(n.radius, width / 2, height / 2) : 0;
  const box = `<rect x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" rx="${r(rx)}" fill="none" stroke="#7db4e8" stroke-width="${r(stroke)}"/>`;
  // Padding ring: shade the inset between the border box and the content box
  // (DevTools-style green), when the node declares uniform padding.
  let pad = "";
  if (n.padding !== undefined && n.padding > 0 && width > 2 * n.padding && height > 2 * n.padding) {
    const p = n.padding;
    pad =
      `<path fill="#3ddc84" fill-opacity="0.18" fill-rule="evenodd" d="` +
      `M${r(x)},${r(y)} H${r(x + width)} V${r(y + height)} H${r(x)} Z ` +
      `M${r(x + p)},${r(y + p)} H${r(x + width - p)} V${r(y + height - p)} H${r(x + p)} Z" />`;
  }
  const detail = [`${Math.round(width)}×${Math.round(height)}`];
  if (n.radius !== undefined) detail.push(`r${+n.radius}`);
  if (n.padding !== undefined) detail.push(`p${+n.padding}`);
  return `<g class="anno-box">${pad}${box}${tag(x, y, detail.join(" "), u, "#16283a", "#cfe6ff")}</g>`;
}

/** Typography callout for one text node (the "typography" layer). */
function typographyMark(n: Placed, u: number): string {
  const t = n.typography!;
  const parts: string[] = [];
  if (t.fontFamily) parts.push(t.fontFamily);
  if (t.fontSize !== undefined) parts.push(`${+t.fontSize}sp`);
  if (t.fontWeight !== undefined) parts.push(String(t.fontWeight));
  if (t.lineHeight !== undefined) parts.push(`lh ${+t.lineHeight}`);
  const label = parts.join(" · ");
  if (!label && !n.color) return "";
  const { x, y } = n.bounds;
  const fs = 2.6 * u;
  const swatch = n.color
    ? `<rect x="${r(x)}" y="${r(y - fs * 1.7)}" width="${r(fs * 1.4)}" height="${r(fs * 1.4)}" rx="${r(0.4 * u)}" fill="${escapeHtml(n.color)}" stroke="#000" stroke-width="${r(0.15 * u)}"/>`
    : "";
  const textX = n.color ? x + fs * 1.9 : x;
  return (
    `<g class="anno-type">` + swatch + (label ? tag(textX, y - fs * 1.85, label, u, "#241a33", "#e6d8ff") : "") + `</g>`
  );
}

/**
 * One matched-element geometry delta from the structural layout diff — the
 * `detail` of a `layout` finding (`reference − candidate`, in the reference's
 * dp space). Shown numerically; sign convention follows the finding.
 */
export interface LayoutDelta {
  label: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** `+8` / `-8` / `0` — a signed delta for the readout. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Highlight + readout for an element the layout diff flagged as shifted/resized.
 * The box is the element's own bounds on this panel; the tag (placed below, so
 * it clears the box-model tag at top-left) carries the numeric drift.
 */
function layoutMark(n: Placed, d: LayoutDelta, u: number): string {
  const { x, y, width, height } = n.bounds;
  const stroke = 0.45 * u;
  const text = `Δpos ${signed(d.dx)},${signed(d.dy)} · Δsize ${signed(d.dw)},${signed(d.dh)}`;
  return (
    `<g class="anno-delta">` +
    `<rect x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" fill="#e8a23a" fill-opacity="0.12" stroke="#e8a23a" stroke-width="${r(stroke)}"/>` +
    tag(x, y + height, text, u, "#3a2a10", "#ffd98a") +
    `</g>`
  );
}

/**
 * Build the annotation `<svg>` for a panel from its semantic tree, or `""` when
 * there's nothing to draw. Layers are hidden by default (CSS) and toggled by the
 * report's controls. `deltas` are the structural layout diff's per-element
 * geometry findings — matched to a node by label, they drive the layout layer.
 */
export function annotationSvg(
  tree: SemanticTree | undefined,
  deltas?: readonly LayoutDelta[],
  opts?: { diff?: boolean },
): string {
  if (!tree) return "";
  const nodes = flatten(tree);
  if (nodes.length === 0) return "";
  const frame = tree.root.bounds ?? bbox(nodes);
  if (!frame || frame.width <= 0 || frame.height <= 0) return "";
  const u = frame.width / 100;

  // Layout deltas: match each finding to the first node with the same label and
  // highlight it (the element's own box on this panel, with the numeric drift).
  let layout = "";
  if (deltas && deltas.length > 0) {
    const byLabel = new Map<string, Placed>();
    for (const n of nodes) {
      if (n.label === undefined) continue;
      const k = n.label.trim().toLowerCase();
      if (!byLabel.has(k)) byLabel.set(k, n);
    }
    layout = deltas
      .map((d) => {
        const n = byLabel.get(d.label.trim().toLowerCase());
        return n ? layoutMark(n, d, u) : "";
      })
      .join("");
  }

  const svgOpen = `<svg class="anno" viewBox="${r(frame.x)} ${r(frame.y)} ${r(frame.width)} ${r(frame.height)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;

  // Diff panel: surface *which* elements differ, not just which pixels. Draw only
  // the layout deltas, in an always-on group (no `data-layer`, so the toggle
  // controls don't hide it) — the diff view's whole job is to show differences.
  if (opts?.diff) {
    if (!layout) return "";
    return `${svgOpen}<g class="anno-diff">${layout}</g></svg>`;
  }

  const boxes = nodes
    .filter((n) => n.label !== undefined || n.role)
    .map((n) => boxMark(n, u))
    .join("");
  const typography = nodes
    .filter((n) => n.typography)
    .map((n) => typographyMark(n, u))
    .join("");
  if (!boxes && !typography && !layout) return "";

  return (
    `${svgOpen}` +
    `<g data-layer="spacing">${boxes}</g>` +
    `<g data-layer="typography">${typography}</g>` +
    `<g data-layer="layout">${layout}</g>` +
    `</svg>`
  );
}
