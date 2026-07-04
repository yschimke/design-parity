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
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildImportPlan, planToSvg } from "../dist/index.js";

const manifest = {
  schema: "design-parity-catalog/v1",
  system: "compose-m3",
  title: "Compose Material 3",
  components: [
    { componentId: "Button/Filled", group: "Buttons",
      images: [
        { variant: "ideal", path: "a", state: "default", theme: "light", width: 200, height: 72 },
        { variant: "ideal", path: "b", state: "default", theme: "dark", width: 200, height: 72 },
      ],
      greenlines: [{ kind: "a11y", severity: "info", message: "Role: button · label “Save”", bounds: { x: 8, y: 8, width: 184, height: 56 } }],
      redlines: [] },
    { componentId: "Button/Outlined", group: "Buttons",
      images: [{ variant: "ideal", path: "c", state: "default", theme: "light", width: 200, height: 72 }],
      greenlines: [{ kind: "a11y", severity: "error", message: "Touch target 40dp < 48dp minimum", bounds: { x: 30, y: 20, width: 140, height: 32 } }],
      redlines: [] },
    { componentId: "Switch/On", group: "Selection",
      images: [{ variant: "ideal", path: "d", state: "on", theme: "light", width: 120, height: 60 }],
      greenlines: [{ kind: "contrast", severity: "warn", message: "Track contrast 2.9:1 (AA needs 3:1)", bounds: { x: 10, y: 14, width: 100, height: 32 } }],
      redlines: [] },
  ],
};
const themeTokens = {
  colors: { primary: "#6750A4", secondary: "#625B71", "surface.light": "#FFFBFE", "surface.dark": "#1C1B1F", error: "#B3261E" },
  radius: { small: 8, medium: 12, large: 16 },
};

const plan = buildImportPlan(manifest, { baseUrl: "https://x", themeTokens });
const out = fileURLToPath(new URL("./canvas-preview.svg", import.meta.url));
await writeFile(out, planToSvg(plan));
console.log(`wrote ${out}`);
