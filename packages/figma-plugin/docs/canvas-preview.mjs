/**
 * Regenerate the committed canvas-preview evidence (docs/canvas-preview.svg).
 *
 * The SVG is a deterministic, offline layout proof of what the plugin builds on
 * a Figma canvas — a Figma plugin can't be rendered headlessly in CI, so this
 * stands in for the "actual pixels" a visual PR needs. Run after `npm run build`
 * (it imports the built planner + planToSvg from dist/):
 *
 *   npm run build --workspace @design-parity/figma-plugin
 *   node packages/figma-plugin/docs/canvas-preview.mjs
 *
 * To rasterize the SVG to the committed PNG for inline embedding:
 *
 *   chromium --headless --force-device-scale-factor=2 --hide-scrollbars \
 *     --window-size=<w>,<h+50> --screenshot=docs/canvas-preview.png \
 *     "file://$PWD/docs/canvas-preview.svg"
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildImportPlan, planToSvg } from "../dist/index.js";

// The sample catalog + tokens live in a JSON fixture shared with the staleness
// gate (test/preview-evidence.test.ts) so the two can't drift.
const sample = JSON.parse(
  await readFile(new URL("./sample-catalog.json", import.meta.url), "utf8"),
);

/** The committed evidence SVGs, as `name → svg` (shared shape with the test). */
export function evidenceSvgs({ manifest, themeTokens }) {
  return {
    "canvas-preview": planToSvg(
      buildImportPlan(manifest, { baseUrl: "https://x", themeTokens }),
    ),
    "canvas-preview-layout": planToSvg(
      buildImportPlan(manifest, { baseUrl: "https://x", themeTokens, variant: "layout" }),
    ),
  };
}

for (const [name, svg] of Object.entries(evidenceSvgs(sample))) {
  const out = fileURLToPath(new URL(`./${name}.svg`, import.meta.url));
  await writeFile(out, svg);
  console.log(`wrote ${out}`);
}
