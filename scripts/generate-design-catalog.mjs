#!/usr/bin/env node
/**
 * Generate an importable design-artifact catalog from a rendered catalog module.
 *
 * Pipeline:  compose-preview render  →  this script  →  design-artifacts/<system>
 *
 *   node scripts/generate-design-catalog.mjs \
 *     --spec   <path to catalog.spec.json> \
 *     --renders <compose-preview output dir or .zip (has previews.json + PNGs)> \
 *     --out    <output bundle dir> \
 *     [--renderer "compose-preview 0.16.2"]
 *
 * It reads the static preview bundle with `@design-parity/candidate`
 * (`loadPreviewBundle` → `CandidateRender[]`), joins it to the committed spec
 * with `@design-parity/catalog-export` (`catalogFromCandidates`), and writes the
 * importable bundle (`catalog.json` + `tokens.dtcg.json` + `figma-variables.json`
 * + `images/`). The caller (the weekly workflow) commits the result to the
 * system's `design-artifacts/<system>` branch.
 *
 * Run after `npm run build` so the workspace `dist/` is present.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadPreviewBundle } from "@design-parity/candidate";
import { catalogFromCandidates, writeCatalog } from "@design-parity/catalog-export";

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    renders: { type: "string" },
    out: { type: "string" },
    renderer: { type: "string" },
  },
});

if (!values.spec || !values.renders || !values.out) {
  console.error(
    "usage: generate-design-catalog --spec <catalog.spec.json> --renders <dir|zip> --out <dir> [--renderer <s>]",
  );
  process.exit(2);
}

const specPath = resolve(values.spec);
const rendersPath = resolve(values.renders);
const outPath = resolve(values.out);

const spec = JSON.parse(await readFile(specPath, "utf8"));
const candidates = await loadPreviewBundle(rendersPath);

const { catalog, missing } = catalogFromCandidates(candidates, spec, {
  ...(values.renderer ? { renderer: values.renderer } : {}),
});

// Images in the bundle are relative to the render dir; resolve them from there.
const sourceRoot = rendersPath.endsWith(".zip") ? dirname(rendersPath) : rendersPath;
const result = await writeCatalog(catalog, outPath, { sourceRoot });

console.log(
  `[${spec.system}] ${catalog.components.length} component(s), ${result.imageCount} image(s) → ${result.manifestPath}`,
);
if (missing.length > 0) {
  console.warn(`[${spec.system}] missing renders for: ${missing.join(", ")}`);
}
