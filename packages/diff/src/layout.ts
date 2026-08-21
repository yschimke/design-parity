/**
 * Structural layout diff.
 *
 * The token diff catches *value* drift (a 12dp gap vs a 16dp spec); the visual
 * diff catches *pixels*. Neither says "this row is 8dp lower than the design" or
 * "the input is 8dp shorter" in words — those land in the pixel heatmap for a
 * human to eyeball. This surfaces them **structurally**: match each reference
 * element to its candidate counterpart by label and report the per-element
 * position/size delta, so a padding/spacer/size mismatch is a named finding.
 *
 * The two sides arrive in **different coordinate spaces**: the candidate's
 * bounds come from its render in device pixels, the reference's from its own
 * capture in dp. When *both* trees declare their render frame on the root
 * (`root.bounds`), {@link diffLayout} normalises before matching — it scales the
 * candidate into the reference's space by the ratio of the two frame widths,
 * which recovers the density factor and leaves deltas in designer-meaningful dp.
 * A *uniform* scale is exactly what a density/zoom difference is, so removing it
 * surfaces the *relative* drift (a shifted row, a fatter spacer) that a defect
 * actually is. Absent a frame on either side the trees are assumed to already
 * share a space (scale 1). When the reference carries no bounds (not captured),
 * the diff is a no-op.
 */
import type { Bounds, Finding, SemanticNode, SemanticTree } from "@design-parity/core";

import type { DiffConfig } from "./config.js";

/** A labelled, positioned element pulled out of a tree for matching. */
export interface PlacedElement {
  label: string;
  role?: string;
  bounds: Bounds;
}

/** Flatten a tree to its labelled, bounded nodes (the ones we can match). */
export function flattenPlaced(tree: SemanticTree | undefined): PlacedElement[] {
  const out: PlacedElement[] = [];
  if (!tree) return out;
  const visit = (n: SemanticNode): void => {
    if (n.label && n.bounds) {
      out.push({ label: n.label.trim(), ...(n.role ? { role: n.role } : {}), bounds: n.bounds });
    }
    for (const child of n.children ?? []) visit(child);
  };
  visit(tree.root);
  return out;
}

function centerOf(b: Bounds): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * The tree's declared render-frame width (`root.bounds.width`), or `undefined`
 * when the root carries no frame. Used to derive the candidate→reference scale;
 * a missing frame means "assume the trees already share a space".
 */
export function frameWidth(tree: SemanticTree | undefined): number | undefined {
  const w = tree?.root.bounds?.width;
  return w && w > 0 ? w : undefined;
}

/** Scale an element's bounds by `s` (mapping it into the reference's space). */
function scaleElement(e: PlacedElement, s: number): PlacedElement {
  return {
    ...e,
    bounds: {
      x: e.bounds.x * s,
      y: e.bounds.y * s,
      width: e.bounds.width * s,
      height: e.bounds.height * s,
    },
  };
}

/**
 * Match each reference element to the nearest still-unmatched candidate element
 * with the same label, and raise a `layout` finding when their top-left position
 * or size differs by more than `layoutTolerance` on any axis. Findings are
 * advisory (`warn`) — geometry drift is informative, not a hard gate. A
 * reference element with no candidate counterpart is left to the semantic/token
 * checks (a *missing* element is a different concern from a *shifted* one).
 */
export function diffLayout(
  reference: SemanticTree | undefined,
  candidate: SemanticTree | undefined,
  config: DiffConfig,
): Finding[] {
  const findings: Finding[] = [];
  const refs = flattenPlaced(reference);
  if (refs.length === 0) return findings; // no reference geometry captured
  // Normalise the candidate's device-pixel geometry into the reference's dp
  // space: a uniform scale by the frame-width ratio recovers the density factor
  // so the per-element deltas below read in dp. A scale of 1 (same space, or no
  // frame info) leaves the candidate untouched.
  const candsRaw = flattenPlaced(candidate);
  const refWidth = frameWidth(reference);
  const candWidth = frameWidth(candidate);
  const scale =
    refWidth !== undefined && candWidth !== undefined ? refWidth / candWidth : 1;
  const cands = scale === 1 ? candsRaw : candsRaw.map((c) => scaleElement(c, scale));
  const used = new Set<number>();
  const tol = config.layoutTolerance;

  for (const r of refs) {
    const rc = centerOf(r.bounds);
    let best = -1;
    let bestDist = Infinity;
    cands.forEach((c, i) => {
      if (used.has(i)) return;
      if (c.label.toLowerCase() !== r.label.toLowerCase()) return;
      const cc = centerOf(c.bounds);
      const d = Math.hypot(cc.x - rc.x, cc.y - rc.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0) continue;
    used.add(best);
    const c = cands[best]!;
    const dx = Math.round(r.bounds.x - c.bounds.x);
    const dy = Math.round(r.bounds.y - c.bounds.y);
    const dw = Math.round(r.bounds.width - c.bounds.width);
    const dh = Math.round(r.bounds.height - c.bounds.height);
    // A text node's width — and the horizontal shift a width change induces — is
    // content-/fill-dependent, not a layout property: the reference measures the
    // tight glyph box while the candidate may report a fill-width row (or a
    // different sample string), so a section header lines up vertically yet reads
    // a huge `Δwidth`. Gate text on vertical position + height only, where a real
    // shift/resize still lands but a "same place, wider box" doesn't. Objects —
    // controls/graphics that carry a role — keep their full box, where width and
    // position are genuine geometry. (Verified against a real DeviceBodyPreview
    // diff: the vertical drift there is real relative drift, not a frame artifact,
    // so only the content-width axis is relaxed.)
    const isText = r.role === undefined;
    const worst = isText
      ? Math.max(Math.abs(dy), Math.abs(dh))
      : Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh));
    if (worst > tol) {
      findings.push({
        kind: "layout",
        severity: "warn",
        message: `layout "${r.label}": offset (${dx}, ${dy}), size Δ(${dw}, ${dh}) vs candidate`,
        detail: { label: r.label, dx, dy, dw, dh },
      });
    }
  }
  return findings;
}
