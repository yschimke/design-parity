/**
 * Render an {@link ImportPlan} to a standalone **SVG preview** of the Figma
 * scene it describes — group headers, component rows, image placeholder boxes
 * (to scale, labelled with their variant + pixel size), the a11y greenline
 * overlay, and a swatch strip for the variable collection.
 *
 * This is not a pixel-accurate mirror of the canvas (it has no PNG bytes — the
 * boxes are placeholders); it is a deterministic, offline **layout proof** so a
 * reviewer — and this package's own tests — can see what the plugin will build
 * without a live Figma session. Pure: string in, string out, no `figma`, no I/O.
 */
import { REDLINE_HEX, redlineLabel, severityHex } from "./annotations.js";
import type { ImportPlan, PlannedComponent } from "./plan.js";

const PAD = 24;
const GROUP_GAP = 28;
const ROW_GAP = 22;
const IMG_GAP = 12;
const LABEL_H = 18;
const MAX_IMG_W = 150;
const SWATCH = 26;

const FONT =
  "font-family='Inter, system-ui, sans-serif'";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Per-image display scale so a wide render fits the preview column. */
function scaleFor(width: number): number {
  return width > MAX_IMG_W ? MAX_IMG_W / width : 1;
}

interface Cursor {
  y: number;
  width: number;
  parts: string[];
}

function drawComponent(c: PlannedComponent, cur: Cursor): void {
  let x = PAD;
  const rowTop = cur.y;
  cur.parts.push(
    `<text x='${PAD}' y='${rowTop + 12}' ${FONT} font-size='12' font-weight='600' fill='#1f2328'>${esc(c.componentId)}</text>`,
  );
  let boxTop = rowTop + LABEL_H;
  let rowH = 0;

  c.images.forEach((img, i) => {
    const s = scaleFor(img.width);
    const w = Math.round(img.width * s);
    const h = Math.round(img.height * s);
    cur.parts.push(
      `<rect x='${x}' y='${boxTop}' width='${w}' height='${h}' rx='4' fill='#f6f8fa' stroke='#d0d7de'/>` +
        `<text x='${x + w / 2}' y='${boxTop + h / 2}' ${FONT} font-size='9' fill='#57606a' text-anchor='middle'>${esc(img.key || "default")}</text>` +
        `<text x='${x + w / 2}' y='${boxTop + h / 2 + 11}' ${FONT} font-size='8' fill='#8c959f' text-anchor='middle'>${img.width}×${img.height}</text>`,
    );

    // Greenlines and redlines anchor to the first image's pixel space.
    if (i === 0) {
      for (const g of c.greenlines) {
        if (!g.bounds) continue;
        const gx = x + g.bounds.x * s;
        const gy = boxTop + g.bounds.y * s;
        cur.parts.push(
          `<rect x='${gx.toFixed(1)}' y='${gy.toFixed(1)}' width='${(g.bounds.width * s).toFixed(1)}' height='${(g.bounds.height * s).toFixed(1)}' fill='none' stroke='${severityHex(g.severity)}' stroke-width='1.5'/>`,
        );
      }
      for (const r of c.redlines) {
        const rx = x + r.bounds.x * s;
        const ry = boxTop + r.bounds.y * s;
        cur.parts.push(
          `<rect x='${rx.toFixed(1)}' y='${ry.toFixed(1)}' width='${(r.bounds.width * s).toFixed(1)}' height='${(r.bounds.height * s).toFixed(1)}' rx='${((r.cornerRadius ?? 0) * s).toFixed(1)}' fill='none' stroke='${REDLINE_HEX}' stroke-width='1' stroke-dasharray='3 2'/>`,
        );
      }
    }
    x += w + IMG_GAP;
    rowH = Math.max(rowH, h);
  });

  cur.width = Math.max(cur.width, x - IMG_GAP + PAD);
  let below = boxTop + rowH + 6;

  // Greenline captions beneath the row.
  for (const g of c.greenlines) {
    cur.parts.push(
      `<circle cx='${PAD + 4}' cy='${below + 4}' r='4' fill='${severityHex(g.severity)}'/>` +
        `<text x='${PAD + 14}' y='${below + 8}' ${FONT} font-size='10' fill='#424a53'>${esc(g.message)}</text>`,
    );
    below += 15;
  }
  // Redline captions (the spacing spec) beneath the row.
  for (const r of c.redlines) {
    const label = redlineLabel(r);
    if (!label) continue;
    cur.parts.push(
      `<rect x='${PAD}' y='${below}' width='8' height='8' fill='none' stroke='${REDLINE_HEX}' stroke-dasharray='2 1.5'/>` +
        `<text x='${PAD + 14}' y='${below + 8}' ${FONT} font-size='10' fill='#424a53'>${esc(label)}</text>`,
    );
    below += 15;
  }
  cur.y = below + ROW_GAP;
}

/** Render the plan to a self-contained SVG string (pure, deterministic). */
export function planToSvg(plan: ImportPlan): string {
  const cur: Cursor = { y: PAD, width: 360, parts: [] };

  cur.parts.push(
    `<text x='${PAD}' y='${cur.y + 16}' ${FONT} font-size='18' font-weight='700' fill='#1f2328'>${esc(plan.title)}</text>`,
  );
  cur.y += 28;
  cur.parts.push(
    `<text x='${PAD}' y='${cur.y + 10}' ${FONT} font-size='11' fill='#57606a'>${plan.imageCount} render${plan.imageCount === 1 ? "" : "s"} · ${plan.greenlineCount} a11y greenline${plan.greenlineCount === 1 ? "" : "s"}${plan.redlineCount > 0 ? ` · ${plan.redlineCount} redline${plan.redlineCount === 1 ? "" : "s"}` : ""}${plan.collection ? ` · ${plan.collection.variables.length} variables` : ""}</text>`,
  );
  cur.y += 24;

  for (const group of plan.groups) {
    cur.parts.push(
      `<text x='${PAD}' y='${cur.y + 12}' ${FONT} font-size='13' font-weight='600' fill='#0969da'>${esc(group.name)}</text>`,
    );
    cur.y += 24;
    for (const component of group.components) drawComponent(component, cur);
    cur.y += GROUP_GAP - ROW_GAP;
  }

  // Variable collection swatch strip.
  if (plan.collection) {
    const colors = plan.collection.variables.filter((v) => v.resolvedType === "COLOR");
    if (colors.length > 0) {
      cur.parts.push(
        `<text x='${PAD}' y='${cur.y + 12}' ${FONT} font-size='13' font-weight='600' fill='#0969da'>Variables — ${esc(plan.collection.name)}</text>`,
      );
      cur.y += 24;
      const cellW = SWATCH + 30;
      let x = PAD;
      for (const v of colors) {
        const value = Object.values(v.valuesByMode)[0];
        const label = v.name.replace(/^color\//, "");
        cur.parts.push(
          `<rect x='${x}' y='${cur.y}' width='${SWATCH}' height='${SWATCH}' rx='4' fill='${esc(String(value))}' stroke='#d0d7de'/>` +
            `<text x='${x}' y='${cur.y + SWATCH + 11}' ${FONT} font-size='8' fill='#57606a'>${esc(label)}</text>`,
        );
        x += cellW;
      }
      cur.width = Math.max(cur.width, x + PAD);
      cur.y += SWATCH + 16 + PAD;
    }
  }

  const w = Math.ceil(cur.width);
  const h = Math.ceil(cur.y);
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<rect width='${w}' height='${h}' fill='#ffffff'/>` +
    cur.parts.join("") +
    `</svg>`
  );
}
